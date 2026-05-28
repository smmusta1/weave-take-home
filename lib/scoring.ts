import type { LLMPRScore, PRCategory, PullRequest } from "./types";

const CATEGORY_WEIGHT: Record<PRCategory, number> = {
  feature: 1.0,
  fix: 1.1,
  refactor: 0.8,
  infra: 1.0,
  docs: 0.3,
  glue: 0.7,
};

const PER_PR_HOURS_CAP = 40;

export function outputScore(prScores: LLMPRScore[], reverted: Set<number>): number {
  let total = 0;
  for (const s of prScores) {
    const base = Math.min(s.expertHours, PER_PR_HOURS_CAP);
    const weighted = base * CATEGORY_WEIGHT[s.category];
    const final = reverted.has(s.prNumber) ? weighted * 0.25 : weighted;
    total += final;
  }
  return total;
}

export function fileCriticality(
  filePath: string,
  touchFrequency: Map<string, number>,
): number {
  const touches = touchFrequency.get(filePath) ?? 1;
  return Math.log1p(touches);
}

export function durabilityMultiplier(survivingFraction: number): number {
  const clamped = Math.max(0, Math.min(1, survivingFraction));
  return 0.5 + clamped;
}

export function combineImpact(output: number, leverage: number, durability: number): number {
  return (output * 0.5 + leverage * 0.5) * durability;
}

export function inferArchetype(stats: {
  output: number;
  leverage: number;
  prsAuthored: number;
  prsReviewed: number;
  uniqueAuthorsReviewed: number;
  topLevelDirsTouched: number;
}): "Tech Lead" | "Architect" | "Solver" | "Glue" | "Shipper" {
  const { output, leverage, prsAuthored, prsReviewed, uniqueAuthorsReviewed, topLevelDirsTouched } = stats;
  const reviewHeavy = prsReviewed > prsAuthored * 1.5;
  const broadMentorship = uniqueAuthorsReviewed >= 10;
  const concentrated = topLevelDirsTouched <= 2 && output > 0;
  const broad = topLevelDirsTouched >= 5;

  if (reviewHeavy && broadMentorship && output < leverage * 0.6) return "Glue";
  if (concentrated && output > 0) return "Architect";
  if (broad && prsAuthored >= 10) return "Solver";
  if (output >= leverage) return "Shipper";
  return "Tech Lead";
}

export function reverted(pr: PullRequest): boolean {
  return pr.reverted;
}
