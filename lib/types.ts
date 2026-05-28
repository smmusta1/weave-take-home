export type PRCategory = "feature" | "fix" | "refactor" | "infra" | "docs" | "glue";
export type ArchetypeLabel = "Tech Lead" | "Architect" | "Solver" | "Glue" | "Shipper";

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  authorLogin: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: { path: string; additions: number; deletions: number }[];
  labels: string[];
  linkedIssueNumbers: number[];
  reviews: PRReview[];
  reverted: boolean;
}

export interface PRReview {
  reviewerLogin: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
  submittedAt: string;
  commentCount: number;
}

export interface LLMPRScore {
  prNumber: number;
  expertHours: number;
  category: PRCategory;
  complexity: 1 | 2 | 3 | 4 | 5;
  risk: 1 | 2 | 3 | 4 | 5;
  rationale: string;
}

export interface EngineerImpact {
  login: string;
  name?: string;
  avatarUrl?: string;
  archetype: ArchetypeLabel;
  totalScore: number;
  output: number;
  leverage: number;
  durability: number;
  narrative: string;
  topPRs: { number: number; title: string; url: string; expertHours: number }[];
  stats: {
    prsAuthored: number;
    prsReviewed: number;
    uniqueAuthorsReviewed: number;
    filesTouched: number;
    linesSurviving: number;
  };
}

export interface ImpactReport {
  window: { startISO: string; endISO: string; prCount: number; engineerCount: number };
  topEngineers: EngineerImpact[];
  methodology: {
    summary: string;
    axes: { name: string; description: string; weight: number }[];
    caveats: string[];
  };
}
