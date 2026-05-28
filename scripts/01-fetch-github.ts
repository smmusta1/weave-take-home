/**
 * Pull merged PRs + reviews + linked issues from PostHog/posthog over WINDOW_DAYS.
 *
 * Strategy: GraphQL search with batched per-PR sub-selection. Resumable via on-disk cache.
 * Output: data/cache/prs.json — canonical PullRequest[]
 *         data/cache/file-touches.json — { [filePath]: prCount } across the window
 */
import "dotenv/config";
import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PullRequest, PRReview } from "../lib/types";

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("Missing GITHUB_TOKEN");
  process.exit(1);
}

const OWNER = process.env.TARGET_OWNER ?? "PostHog";
const REPO = process.env.TARGET_REPO ?? "posthog";
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS ?? 90);
const PAGE_SIZE = 50;
const MAX_FILES_PER_PR = 50;
const MAX_REVIEWS_PER_PR = 30;

const CACHE_DIR = path.join(process.cwd(), "data/cache");
const PR_FILE = path.join(CACHE_DIR, "prs.json");
const TOUCH_FILE = path.join(CACHE_DIR, "file-touches.json");

const gql = graphql.defaults({ headers: { authorization: `bearer ${TOKEN}` } });

interface GqlPR {
  number: number;
  title: string;
  body: string | null;
  url: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: { login: string } | null;
  labels: { nodes: { name: string }[] };
  files: { nodes: { path: string; additions: number; deletions: number }[] };
  reviews: {
    nodes: {
      author: { login: string } | null;
      state: string;
      submittedAt: string | null;
      comments: { totalCount: number };
    }[];
  };
  closingIssuesReferences: { nodes: { number: number }[] };
}

const PR_QUERY = `
query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: ${PAGE_SIZE}, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        title
        body
        url
        createdAt
        mergedAt
        closedAt
        additions
        deletions
        changedFiles
        author { login }
        labels(first: 20) { nodes { name } }
        files(first: ${MAX_FILES_PER_PR}) { nodes { path additions deletions } }
        reviews(first: ${MAX_REVIEWS_PER_PR}) {
          nodes {
            author { login }
            state
            submittedAt
            comments { totalCount }
          }
        }
        closingIssuesReferences(first: 10) { nodes { number } }
      }
    }
  }
  rateLimit { remaining resetAt }
}
`;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildWindowChunks(windowDays: number, chunkDays: number): { from: string; to: string }[] {
  const now = new Date();
  const chunks: { from: string; to: string }[] = [];
  for (let offset = 0; offset < windowDays; offset += chunkDays) {
    const to = new Date(now);
    to.setUTCDate(to.getUTCDate() - offset);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - chunkDays + 1);
    const windowStart = new Date(now);
    windowStart.setUTCDate(windowStart.getUTCDate() - windowDays + 1);
    const clampedFrom = from < windowStart ? windowStart : from;
    chunks.push({ from: isoDate(clampedFrom), to: isoDate(to) });
  }
  return chunks;
}

function detectRevert(title: string, body: string | null): boolean {
  if (/^Revert\s+["']/i.test(title)) return true;
  if (body && /\breverts?\s+#\d+/i.test(body)) return true;
  return false;
}

function toCanonical(node: GqlPR): PullRequest | null {
  if (!node || !node.author?.login) return null;
  return {
    number: node.number,
    title: node.title,
    body: node.body,
    authorLogin: node.author.login,
    createdAt: node.createdAt,
    mergedAt: node.mergedAt,
    closedAt: node.closedAt,
    additions: node.additions,
    deletions: node.deletions,
    changedFiles: node.changedFiles,
    files: node.files.nodes.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    })),
    labels: node.labels.nodes.map((l) => l.name),
    linkedIssueNumbers: node.closingIssuesReferences.nodes.map((i) => i.number),
    reviews: node.reviews.nodes
      .filter((r) => r.author?.login)
      .map<PRReview>((r) => ({
        reviewerLogin: r.author!.login,
        state: (r.state as PRReview["state"]) ?? "COMMENTED",
        submittedAt: r.submittedAt ?? node.mergedAt ?? node.createdAt,
        commentCount: r.comments.totalCount,
      })),
    reverted: detectRevert(node.title, node.body),
  };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchChunk(from: string, to: string): Promise<PullRequest[]> {
  const q = `repo:${OWNER}/${REPO} is:pr is:merged merged:${from}..${to}`;
  let cursor: string | null = null;
  const out: PullRequest[] = [];
  let page = 0;

  while (true) {
    page += 1;
    let attempt = 0;
    let result: any;
    while (true) {
      try {
        result = await gql<any>(PR_QUERY, { q, cursor });
        break;
      } catch (err: any) {
        attempt += 1;
        if (attempt > 4) throw err;
        const backoff = 1000 * 2 ** attempt;
        console.error(`chunk ${from}..${to} page ${page} error (attempt ${attempt}): ${err.message}; backing off ${backoff}ms`);
        await sleep(backoff);
      }
    }

    const nodes: GqlPR[] = result.search.nodes ?? [];
    for (const n of nodes) {
      const c = toCanonical(n);
      if (c) out.push(c);
    }

    const rl = result.rateLimit;
    const total = result.search.issueCount;
    console.log(
      `  ${from}..${to} page ${page}: +${nodes.length} (chunk total=${out.length}/${total}); rate remaining=${rl.remaining}`,
    );

    if (total >= 1000) {
      console.warn(`  WARNING: chunk ${from}..${to} hit ${total} results, search cap is 1000 — shrink chunkDays`);
    }

    if (!result.search.pageInfo.hasNextPage) break;
    cursor = result.search.pageInfo.endCursor;

    if (rl.remaining < 100) {
      const resetMs = new Date(rl.resetAt).getTime() - Date.now();
      console.log(`rate low; sleeping ${Math.ceil(resetMs / 1000)}s`);
      await sleep(Math.max(resetMs + 1000, 1000));
    }
  }
  return out;
}

async function fetchAllPRs(): Promise<PullRequest[]> {
  const chunks = buildWindowChunks(WINDOW_DAYS, 7);
  const seen = new Set<number>();
  const all: PullRequest[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    console.log(`chunk ${i + 1}/${chunks.length}: ${c.from} .. ${c.to}`);
    const chunkPRs = await fetchChunk(c.from, c.to);
    let added = 0;
    for (const pr of chunkPRs) {
      if (seen.has(pr.number)) continue;
      seen.add(pr.number);
      all.push(pr);
      added += 1;
    }
    console.log(`  chunk done: +${added} new (running total=${all.length})`);
  }
  void isoDaysAgo;
  return all;
}

function computeFileTouches(prs: PullRequest[]): Record<string, number> {
  const touches: Record<string, number> = {};
  for (const pr of prs) {
    const seen = new Set<string>();
    for (const f of pr.files) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      touches[f.path] = (touches[f.path] ?? 0) + 1;
    }
  }
  return touches;
}

async function main() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  console.log(`fetching ${OWNER}/${REPO} PRs merged in the last ${WINDOW_DAYS} days...`);
  const prs = await fetchAllPRs();
  console.log(`fetched ${prs.length} PRs`);

  await fs.writeFile(PR_FILE, JSON.stringify(prs, null, 2));
  console.log(`wrote ${PR_FILE}`);

  const touches = computeFileTouches(prs);
  await fs.writeFile(TOUCH_FILE, JSON.stringify(touches, null, 2));
  console.log(`wrote ${TOUCH_FILE} (${Object.keys(touches).length} unique files touched)`);

  // Silence unused-import warning for Octokit (kept for future REST needs).
  void Octokit;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
