/**
 * Combine raw GitHub data + LLM PR scores → ImpactReport.
 *
 * Steps:
 *   1. Load cached PRs, LLM scores, file-touch frequencies.
 *   2. Restrict to the same candidate set used in scoring (top-N by activity).
 *   3. Output: sum LLM expert-hours * category weight (per-PR capped). Anti-revert downweight.
 *   4. Leverage: review-graph PageRank * file-criticality of files authored & reviewed.
 *      File criticality = log1p(window-wide touch count).
 *   5. Durability: 1 - (fraction of an engineer's authored files in days 1..60 that get
 *      re-touched in days 30..90 by another PR). Clamped to [0.5, 1.5].
 *   6. Combine, rank, take top 5.
 *   7. Per top-5: pick 3 evidence PRs, generate a 2-sentence narrative via Haiku,
 *      infer Larson archetype, write data/derived/impact-report.json.
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "node:fs";
import path from "node:path";
import Graph from "graphology";
import pagerank from "graphology-metrics/centrality/pagerank";
import type {
  ArchetypeLabel,
  EngineerImpact,
  ImpactReport,
  LLMPRScore,
  PRCategory,
  PullRequest,
} from "../lib/types";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error("Missing ANTHROPIC_API_KEY");
  process.exit(1);
}

const CACHE_DIR = path.join(process.cwd(), "data/cache");
const DERIVED_DIR = path.join(process.cwd(), "data/derived");
const PR_FILE = path.join(CACHE_DIR, "prs.json");
const SCORES_FILE = path.join(CACHE_DIR, "llm-scores.json");
const TOUCH_FILE = path.join(CACHE_DIR, "file-touches.json");
const REPORT_FILE = path.join(DERIVED_DIR, "impact-report.json");

const TOP_CANDIDATES = 30;
const TOP_N = 5;
const PER_PR_HOURS_CAP = 40;

const CATEGORY_WEIGHT: Record<PRCategory, number> = {
  feature: 1.0,
  fix: 1.1,
  refactor: 0.8,
  infra: 1.0,
  docs: 0.3,
  glue: 0.7,
};

const anthropic = new Anthropic({ apiKey: KEY });

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

function topLevelDir(p: string): string {
  const i = p.indexOf("/");
  return i === -1 ? p : p.slice(0, i);
}

function authorReviewMap(prs: PullRequest[]): Map<number, string> {
  return new Map(prs.map((p) => [p.number, p.authorLogin]));
}

function buildReviewGraph(prs: PullRequest[], candidates: Set<string>): Graph {
  const g = new Graph({ type: "directed", multi: false });
  for (const c of candidates) g.addNode(c);
  for (const pr of prs) {
    const author = pr.authorLogin;
    if (!candidates.has(author)) continue;
    const seenReviewers = new Map<string, number>();
    for (const r of pr.reviews) {
      const reviewer = r.reviewerLogin;
      if (reviewer === author) continue;
      if (!candidates.has(reviewer)) continue;
      const depth = 1 + r.commentCount * 0.1;
      seenReviewers.set(reviewer, (seenReviewers.get(reviewer) ?? 0) + depth);
    }
    for (const [reviewer, w] of seenReviewers) {
      if (g.hasEdge(reviewer, author)) {
        const prev = g.getEdgeAttribute(reviewer, author, "weight") as number;
        g.setEdgeAttribute(reviewer, author, "weight", prev + w);
      } else {
        g.addEdge(reviewer, author, { weight: w });
      }
    }
  }
  return g;
}

function computeOutput(
  prs: PullRequest[],
  scoresByPr: Map<number, LLMPRScore>,
  login: string,
): { score: number; scoredCount: number; topPRs: { pr: PullRequest; contrib: number }[] } {
  const authored = prs.filter((p) => p.authorLogin === login);
  const contribs: { pr: PullRequest; contrib: number }[] = [];
  let scoredCount = 0;
  for (const pr of authored) {
    const s = scoresByPr.get(pr.number);
    if (!s) continue;
    scoredCount += 1;
    const base = Math.min(s.expertHours, PER_PR_HOURS_CAP);
    const weighted = base * CATEGORY_WEIGHT[s.category];
    const final = pr.reverted ? weighted * 0.25 : weighted;
    contribs.push({ pr, contrib: final });
  }
  const total = contribs.reduce((a, b) => a + b.contrib, 0);
  contribs.sort((a, b) => b.contrib - a.contrib);
  return { score: total, scoredCount, topPRs: contribs.slice(0, 5) };
}

function computeLeverageRaw(
  prs: PullRequest[],
  touches: Record<string, number>,
  pageRanks: Map<string, number>,
  login: string,
): { score: number; filesTouched: number; topLevelDirs: number } {
  const authoredFiles = new Set<string>();
  const dirs = new Set<string>();
  for (const pr of prs) {
    if (pr.authorLogin !== login) continue;
    for (const f of pr.files) {
      authoredFiles.add(f.path);
      dirs.add(topLevelDir(f.path));
    }
  }
  const reviewedFiles = new Set<string>();
  for (const pr of prs) {
    if (!pr.reviews.some((r) => r.reviewerLogin === login)) continue;
    for (const f of pr.files) reviewedFiles.add(f.path);
  }
  const critFor = (paths: Iterable<string>): number => {
    let s = 0;
    for (const p of paths) {
      const t = touches[p] ?? 1;
      s += Math.log1p(t);
    }
    return s;
  };
  const authoredCrit = critFor(authoredFiles);
  const reviewedCrit = critFor(reviewedFiles) * 0.5;
  const pr = pageRanks.get(login) ?? 0;
  const score = (authoredCrit + reviewedCrit) * (1 + pr * 50);
  return {
    score,
    filesTouched: authoredFiles.size,
    topLevelDirs: dirs.size,
  };
}

function computeDurability(prs: PullRequest[], login: string): number {
  const sorted = [...prs].sort(
    (a, b) => new Date(a.mergedAt ?? a.createdAt).getTime() - new Date(b.mergedAt ?? b.createdAt).getTime(),
  );
  if (sorted.length === 0) return 1.0;
  const first = new Date(sorted[0].mergedAt ?? sorted[0].createdAt).getTime();
  const last = new Date(sorted[sorted.length - 1].mergedAt ?? sorted[sorted.length - 1].createdAt).getTime();
  const span = Math.max(last - first, 1);
  const dayMs = 24 * 60 * 60 * 1000;
  const windowDays = span / dayMs;
  const cutoff = first + Math.max(span * (60 / Math.max(windowDays, 90)), 0) ;
  const earlyPRs = sorted.filter((p) => new Date(p.mergedAt ?? p.createdAt).getTime() <= first + dayMs * 60);
  if (earlyPRs.length === 0) return 1.0;

  const earlyAuthored = new Map<string, number>();
  for (const pr of earlyPRs) {
    if (pr.authorLogin !== login) continue;
    for (const f of pr.files) {
      earlyAuthored.set(f.path, (earlyAuthored.get(f.path) ?? 0) + f.additions);
    }
  }
  if (earlyAuthored.size === 0) return 1.0;

  let totalLines = 0;
  let touchedAgain = 0;
  for (const [filePath, lines] of earlyAuthored) {
    totalLines += lines;
    const reTouched = sorted.some(
      (pr) =>
        pr.authorLogin !== login &&
        new Date(pr.mergedAt ?? pr.createdAt).getTime() > cutoff &&
        pr.files.some((f) => f.path === filePath),
    );
    if (reTouched) touchedAgain += lines;
  }
  const survivingFraction = totalLines === 0 ? 1 : 1 - touchedAgain / totalLines;
  return Math.max(0.5, Math.min(1.5, 0.5 + survivingFraction));
}

function inferArchetype(stats: {
  outputNorm: number;
  leverageNorm: number;
  prsAuthored: number;
  prsReviewed: number;
  uniqueAuthorsReviewed: number;
  topLevelDirsTouched: number;
}): ArchetypeLabel {
  const { outputNorm, leverageNorm, prsAuthored, prsReviewed, uniqueAuthorsReviewed, topLevelDirsTouched } =
    stats;
  const reviewHeavy = prsReviewed > prsAuthored * 1.5;
  const broadMentorship = uniqueAuthorsReviewed >= 10;
  const concentrated = topLevelDirsTouched <= 2 && outputNorm > 30;
  const broad = topLevelDirsTouched >= 5;

  if (reviewHeavy && broadMentorship && outputNorm < leverageNorm * 0.6) return "Glue";
  if (concentrated && outputNorm > 0) return "Architect";
  if (broad && prsAuthored >= 10) return "Solver";
  if (outputNorm >= leverageNorm) return "Shipper";
  return "Tech Lead";
}

async function generateNarrative(
  login: string,
  archetype: ArchetypeLabel,
  evidence: { number: number; title: string; expertHours: number; category: PRCategory; rationale: string }[],
  stats: EngineerImpact["stats"],
): Promise<string> {
  const evidenceBlock = evidence
    .map(
      (e) =>
        `  - PR #${e.number} (${e.category}, ~${e.expertHours.toFixed(1)}h): ${e.title}\n    rationale: ${e.rationale}`,
    )
    .join("\n");

  const prompt = [
    `Engineer: @${login}`,
    `Archetype: ${archetype}`,
    `Stats: authored ${stats.prsAuthored} PRs, reviewed ${stats.prsReviewed}, mentored ${stats.uniqueAuthorsReviewed} distinct authors, touched ${stats.filesTouched} files.`,
    `Top evidence PRs:`,
    evidenceBlock,
    "",
    `Write exactly 2 sentences (max 50 words total) describing this engineer's impact on the codebase over the window. Be specific about what they shipped or shaped. Don't restate the stats; explain what kind of impact they had. No fluff, no hedging, no "this engineer".`,
  ].join("\n");

  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text as string)
      .join(" ")
      .trim();
    return text || `Active ${archetype.toLowerCase()} — see linked PRs.`;
  } catch (err: any) {
    console.error(`narrative for @${login} failed:`, err.message);
    return `Active ${archetype.toLowerCase()} — see linked PRs.`;
  }
}

function normalize(map: Map<string, number>): Map<string, number> {
  const max = Math.max(...map.values(), 1);
  const out = new Map<string, number>();
  for (const [k, v] of map) out.set(k, (v / max) * 100);
  return out;
}

async function fetchUserMeta(login: string): Promise<{ name?: string; avatarUrl?: string }> {
  try {
    const res = await fetch(`https://api.github.com/users/${login}`, {
      headers: process.env.GITHUB_TOKEN ? { authorization: `bearer ${process.env.GITHUB_TOKEN}` } : {},
    });
    if (!res.ok) return {};
    const u = await res.json();
    return { name: u.name ?? undefined, avatarUrl: u.avatar_url ?? undefined };
  } catch {
    return {};
  }
}

async function main() {
  await fs.mkdir(DERIVED_DIR, { recursive: true });

  const prs = JSON.parse(await fs.readFile(PR_FILE, "utf8")) as PullRequest[];
  const llmScores = JSON.parse(await fs.readFile(SCORES_FILE, "utf8")) as LLMPRScore[];
  const touches = JSON.parse(await fs.readFile(TOUCH_FILE, "utf8")) as Record<string, number>;
  const scoresByPr = new Map(llmScores.map((s) => [s.prNumber, s]));

  const candidates = rankActivity(prs);
  const candidateSet = new Set(candidates);
  console.log(`evaluating ${candidates.length} candidates`);

  const g = buildReviewGraph(prs, candidateSet);
  const pr = pagerank(g, { getEdgeWeight: "weight" });
  const pageRanks = new Map(Object.entries(pr));

  // Stage 1: raw scores
  type Raw = {
    login: string;
    output: number;
    leverage: number;
    durability: number;
    topPRs: { pr: PullRequest; contrib: number }[];
    stats: EngineerImpact["stats"];
  };
  const raws: Raw[] = [];

  const prAuthorMap = authorReviewMap(prs);
  void prAuthorMap;

  for (const login of candidates) {
    const o = computeOutput(prs, scoresByPr, login);
    const lv = computeLeverageRaw(prs, touches, pageRanks, login);
    const dur = computeDurability(prs, login);

    const prsAuthored = prs.filter((p) => p.authorLogin === login).length;
    const reviewedPRs = prs.filter((p) =>
      p.reviews.some((r) => r.reviewerLogin === login && p.authorLogin !== login),
    );
    const prsReviewed = reviewedPRs.length;
    const uniqueAuthorsReviewed = new Set(reviewedPRs.map((p) => p.authorLogin)).size;
    const filesTouched = lv.filesTouched;
    const linesSurviving = 0; // placeholder — see durability note in methodology

    raws.push({
      login,
      output: o.score,
      leverage: lv.score,
      durability: dur,
      topPRs: o.topPRs,
      stats: {
        prsAuthored,
        prsReviewed,
        uniqueAuthorsReviewed,
        filesTouched,
        linesSurviving,
      },
    });
  }

  // Stage 2: normalize output and leverage to [0,100]; durability stays raw [0.5,1.5]
  const outNorm = normalize(new Map(raws.map((r) => [r.login, r.output])));
  const lvNorm = normalize(new Map(raws.map((r) => [r.login, r.leverage])));

  const scored = raws
    .map((r) => {
      const oN = outNorm.get(r.login) ?? 0;
      const lN = lvNorm.get(r.login) ?? 0;
      const totalScore = (oN * 0.5 + lN * 0.5) * r.durability;
      return { ...r, outputNorm: oN, leverageNorm: lN, totalScore };
    })
    .sort((a, b) => b.totalScore - a.totalScore);

  const top = scored.slice(0, TOP_N);
  console.log("top 5:", top.map((t) => `${t.login}=${t.totalScore.toFixed(1)}`).join(", "));

  // Stage 3: per top-5 narrative + archetype + user meta
  const topEngineers: EngineerImpact[] = [];
  for (const r of top) {
    const archetype = inferArchetype({
      outputNorm: r.outputNorm,
      leverageNorm: r.leverageNorm,
      prsAuthored: r.stats.prsAuthored,
      prsReviewed: r.stats.prsReviewed,
      uniqueAuthorsReviewed: r.stats.uniqueAuthorsReviewed,
      topLevelDirsTouched:
        new Set(
          prs
            .filter((p) => p.authorLogin === r.login)
            .flatMap((p) => p.files.map((f) => topLevelDir(f.path))),
        ).size,
    });

    const evidence = r.topPRs.slice(0, 3).map((c) => {
      const s = scoresByPr.get(c.pr.number);
      return {
        number: c.pr.number,
        title: c.pr.title,
        expertHours: s?.expertHours ?? 0,
        category: s?.category ?? ("feature" as PRCategory),
        rationale: s?.rationale ?? "",
      };
    });

    const [narrative, meta] = await Promise.all([
      generateNarrative(r.login, archetype, evidence, r.stats),
      fetchUserMeta(r.login),
    ]);

    topEngineers.push({
      login: r.login,
      name: meta.name,
      avatarUrl: meta.avatarUrl,
      archetype,
      totalScore: Number(r.totalScore.toFixed(2)),
      output: Number(r.outputNorm.toFixed(2)),
      leverage: Number(r.leverageNorm.toFixed(2)),
      durability: Number(r.durability.toFixed(2)),
      narrative,
      topPRs: evidence.map((e) => ({
        number: e.number,
        title: e.title,
        url: `https://github.com/${process.env.TARGET_OWNER ?? "PostHog"}/${process.env.TARGET_REPO ?? "posthog"}/pull/${e.number}`,
        expertHours: Number(e.expertHours.toFixed(1)),
      })),
      stats: r.stats,
    });
    console.log(`  built card for @${r.login} (${archetype})`);
  }

  const sortedByDate = [...prs].sort(
    (a, b) => new Date(a.mergedAt ?? a.createdAt).getTime() - new Date(b.mergedAt ?? b.createdAt).getTime(),
  );
  const startISO = sortedByDate[0]?.mergedAt ?? sortedByDate[0]?.createdAt ?? "";
  const endISO = sortedByDate[sortedByDate.length - 1]?.mergedAt ?? sortedByDate[sortedByDate.length - 1]?.createdAt ?? "";
  const engineerCount = new Set(prs.map((p) => p.authorLogin)).size;

  const report: ImpactReport = {
    window: {
      startISO: startISO.slice(0, 10),
      endISO: endISO.slice(0, 10),
      prCount: prs.length,
      engineerCount,
    },
    topEngineers,
    methodology: {
      summary:
        "Each engineer scored on three axes. Output and Leverage are normalised to 0–100 across the candidate pool; Durability is a multiplier in [0.5, 1.5]. Total = (Output·0.5 + Leverage·0.5) · Durability. Candidate pool is the top 30 contributors by activity over the window; the top 5 are shown.",
      axes: [
        {
          name: "Output",
          description:
            "Quality-adjusted expert-hour estimate from an LLM (Claude Haiku 4.5) reading each PR's title, body, diff summary, files, labels and linked issues. Per-PR capped, category-weighted, reverts down-weighted to 25%.",
          weight: 0.5,
        },
        {
          name: "Leverage",
          description:
            "Review-graph PageRank (reviewer→author edges weighted by review depth) multiplied by file criticality — files central to the codebase, measured by how often they're touched in the window, count more than peripheral ones.",
          weight: 0.5,
        },
        {
          name: "Durability",
          description:
            "Anti-churn multiplier. Fraction of an engineer's authored lines from the first 60 days of the window that aren't subsequently re-touched by other engineers. Code that stands is worth more than code that needs immediate rework.",
          weight: 1.0,
        },
      ],
      caveats: [
        "Only the top 30 candidates by activity are LLM-scored; a high-impact engineer with very few PRs would not appear.",
        "Bots (renovate, dependabot, *-bot) are filtered out.",
        "Durability inside a 90-day window is an approximation; longer windows would be more reliable.",
        "Reverts are detected by title heuristic ('Revert \"...\"') and body references; non-standard revert PRs may be missed.",
        "File criticality is a proxy (in-window touch count), not a true import-graph centrality.",
      ],
    },
  };

  await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`wrote ${REPORT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
