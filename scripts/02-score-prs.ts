/**
 * LLM-score PRs for quality-adjusted output (Weave-style).
 *
 * Strategy:
 *   - Identify top ~30 candidate engineers by (PRs authored + 0.5 * PRs reviewed).
 *   - For each candidate, send their top K=8 PRs (ranked by changedFiles + body length + label
 *     signals) to Claude Haiku 4.5. Cap total scored PRs at ~240 to bound cost/time.
 *   - Schema-constrained tool-call returning LLMPRScore.
 *   - Cache per PR number to data/cache/scores/<prNumber>.json (resumable).
 *   - p-limit concurrency = 6; prompt-cache the system message + calibration block.
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import pLimit from "p-limit";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LLMPRScore, PullRequest } from "../lib/types";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error("Missing ANTHROPIC_API_KEY");
  process.exit(1);
}

const CACHE_DIR = path.join(process.cwd(), "data/cache");
const SCORE_DIR = path.join(CACHE_DIR, "scores");
const PR_FILE = path.join(CACHE_DIR, "prs.json");
const SCORES_FILE = path.join(CACHE_DIR, "llm-scores.json");

const MODEL = "claude-haiku-4-5";
const TOP_CANDIDATES = 30;
const TOP_PRS_PER_CANDIDATE = 8;
const CONCURRENCY = 6;
const MAX_BODY_CHARS = 1500;
const MAX_FILES_LISTED = 25;

const anthropic = new Anthropic({ apiKey: KEY });

const SYSTEM = [
  "You estimate engineering effort behind pull requests with the calibration of an expert reviewer who has worked on this codebase for 5+ years.",
  "",
  "Calibration anchors for `expert_hours` (how long an expert engineer who already knows this codebase would need to complete this change end-to-end, including review iteration):",
  "  0.25h  — trivial typo, comment, dep bump",
  "  1h     — small bug fix in a single function, well-localised",
  "  2-4h   — moderate bug fix needing investigation, or small contained feature",
  "  6-10h  — feature with new endpoint, migration, or tests across a few files",
  "  16h    — feature touching multiple subsystems, schema + API + UI",
  "  24-40h — architectural refactor, multi-week project, or critical-path infra",
  "",
  "Categories:",
  "  feature  — net-new user-visible capability",
  "  fix      — bug fix or hotfix",
  "  refactor — restructuring with no behaviour change",
  "  infra    — CI, build, deploy, tooling, SDK plumbing",
  "  docs     — docs only",
  "  glue     — coordination, cross-team enablement, scaffolding for others",
  "",
  "Be honest. Most PRs are not heroic. If a PR is large because it's generated/boilerplate, score it low. If a PR is small but unblocks a system-critical fix, score it high.",
  "Return a single tool call. The `rationale` should be one sentence explaining the score.",
].join("\n");

const TOOL = {
  name: "scorePR",
  description: "Record the expert-hour estimate and classification for one pull request.",
  input_schema: {
    type: "object",
    properties: {
      expert_hours: {
        type: "number",
        description: "Expert engineer hours equivalent. Use the calibration anchors.",
      },
      category: {
        type: "string",
        enum: ["feature", "fix", "refactor", "infra", "docs", "glue"],
      },
      complexity: { type: "integer", enum: [1, 2, 3, 4, 5] },
      risk: { type: "integer", enum: [1, 2, 3, 4, 5] },
      rationale: { type: "string", description: "One sentence." },
    },
    required: ["expert_hours", "category", "complexity", "risk", "rationale"],
  },
} as const;

function rankActivity(prs: PullRequest[]): string[] {
  const authored = new Map<string, number>();
  const reviewed = new Map<string, number>();
  for (const pr of prs) {
    authored.set(pr.authorLogin, (authored.get(pr.authorLogin) ?? 0) + 1);
    const uniqueReviewers = new Set(pr.reviews.map((r) => r.reviewerLogin));
    for (const r of uniqueReviewers) reviewed.set(r, (reviewed.get(r) ?? 0) + 1);
  }
  const all = new Set([...authored.keys(), ...reviewed.keys()]);
  return [...all]
    .filter((login) => !/\[bot\]$|-bot$|^renovate$|^dependabot/i.test(login))
    .map((login) => ({
      login,
      score: (authored.get(login) ?? 0) + 0.5 * (reviewed.get(login) ?? 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_CANDIDATES)
    .map((x) => x.login);
}

function pickTopPRs(prs: PullRequest[], login: string): PullRequest[] {
  const authored = prs.filter((pr) => pr.authorLogin === login);
  return authored
    .map((pr) => ({
      pr,
      sig:
        pr.changedFiles * 1.5 +
        Math.min((pr.body?.length ?? 0) / 200, 10) +
        (pr.labels.some((l) => /feat|feature|enhancement/i.test(l)) ? 4 : 0) +
        (pr.labels.some((l) => /bug|fix|hotfix|incident|security/i.test(l)) ? 3 : 0) +
        (pr.linkedIssueNumbers.length > 0 ? 2 : 0),
    }))
    .sort((a, b) => b.sig - a.sig)
    .slice(0, TOP_PRS_PER_CANDIDATE)
    .map((x) => x.pr);
}

function buildUserMessage(pr: PullRequest): string {
  const body = (pr.body ?? "").trim().slice(0, MAX_BODY_CHARS);
  const filesShown = pr.files.slice(0, MAX_FILES_LISTED);
  const filesElided = pr.files.length - filesShown.length;
  const filesBlock = filesShown
    .map((f) => `  ${f.path} (+${f.additions} -${f.deletions})`)
    .join("\n");
  const elided = filesElided > 0 ? `\n  ... and ${filesElided} more` : "";
  return [
    `Title: ${pr.title}`,
    `Labels: ${pr.labels.join(", ") || "(none)"}`,
    `Linked issues: ${pr.linkedIssueNumbers.length > 0 ? pr.linkedIssueNumbers.map((n) => `#${n}`).join(", ") : "(none)"}`,
    `Diff: +${pr.additions} -${pr.deletions} across ${pr.changedFiles} files`,
    `Files:`,
    filesBlock + elided,
    "",
    `Body:`,
    body || "(empty)",
  ].join("\n");
}

async function scoreOne(pr: PullRequest): Promise<LLMPRScore | null> {
  const cachePath = path.join(SCORE_DIR, `${pr.number}.json`);
  try {
    const cached = await fs.readFile(cachePath, "utf8");
    return JSON.parse(cached) as LLMPRScore;
  } catch {
    // miss
  }

  const userMsg = buildUserMessage(pr);

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 400,
        system: [
          {
            type: "text",
            text: SYSTEM,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [TOOL as any],
        tool_choice: { type: "tool", name: "scorePR" },
        messages: [{ role: "user", content: userMsg }],
      });
      const tool = res.content.find((b) => b.type === "tool_use");
      if (!tool || tool.type !== "tool_use") {
        throw new Error("no tool_use returned");
      }
      const input = tool.input as Omit<LLMPRScore, "prNumber">;
      const score: LLMPRScore = {
        prNumber: pr.number,
        expertHours: Number(input.expertHours ?? (input as any).expert_hours),
        category: input.category,
        complexity: input.complexity,
        risk: input.risk,
        rationale: input.rationale,
      };
      await fs.writeFile(cachePath, JSON.stringify(score, null, 2));
      return score;
    } catch (err: any) {
      if (attempt > 3) {
        console.error(`PR #${pr.number} failed after ${attempt} attempts:`, err.message);
        return null;
      }
      const backoff = 1500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

async function main() {
  await fs.mkdir(SCORE_DIR, { recursive: true });

  const prs = JSON.parse(await fs.readFile(PR_FILE, "utf8")) as PullRequest[];
  console.log(`loaded ${prs.length} PRs`);

  const candidates = rankActivity(prs);
  console.log(`top ${candidates.length} candidate engineers:`, candidates.join(", "));

  const toScore: PullRequest[] = [];
  const seen = new Set<number>();
  for (const login of candidates) {
    for (const pr of pickTopPRs(prs, login)) {
      if (!seen.has(pr.number)) {
        seen.add(pr.number);
        toScore.push(pr);
      }
    }
  }
  console.log(`scoring ${toScore.length} PRs (deduped across candidates)`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  const results = await Promise.all(
    toScore.map((pr) =>
      limit(async () => {
        const r = await scoreOne(pr);
        done += 1;
        if (done % 10 === 0) console.log(`  scored ${done}/${toScore.length}`);
        return r;
      }),
    ),
  );

  const scores: LLMPRScore[] = results.filter((r): r is LLMPRScore => r !== null);
  await fs.writeFile(SCORES_FILE, JSON.stringify(scores, null, 2));
  console.log(`wrote ${scores.length} scores to ${SCORES_FILE} (${toScore.length - scores.length} failed)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
