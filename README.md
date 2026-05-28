# PostHog Engineering Impact — Weave Take-Home

A single-page dashboard ranking the top 5 most impactful engineers on the PostHog
GitHub repository over the last 90 days, scored on three axes: **Output**, **Leverage**, **Durability**.

## Methodology — short version

```
score = (output * 0.5 + leverage * 0.5) * durability
```

- **Output** — Weave-style quality-adjusted contribution. An LLM (Claude Haiku 4.5) reads each PR
  (title, body, diff summary, linked issue, labels) and estimates `{expert_hours, category, complexity, risk}`.
  Sum per engineer, category-weighted, capped per-PR.
- **Leverage** — code-review network influence. Build a directed graph where each edge is a review
  (reviewer → author) weighted by review depth (comment count, follow-up commits). PageRank picks
  up mentors and knowledge brokers. Multiplied by file-criticality (touch frequency proxy) of the
  files an engineer authors and reviews.
- **Durability** — anti-churn multiplier ∈ [0.5, 1.5]. Fraction of an engineer's lines authored in
  the first 60 days of the window that are still present at day 90.

Each top-5 engineer gets a Larson-style **archetype label** (Tech Lead / Architect / Solver / Glue /
Shipper), a short LLM-written narrative, and three PR links as concrete evidence.

See the in-app methodology panel for the long version and caveats.

## Run locally

```bash
cp .env.example .env   # fill in GITHUB_TOKEN + ANTHROPIC_API_KEY
npm install
npm run pipeline:all   # fetches GitHub data, LLM-scores PRs, builds impact-report.json
npm run dev            # http://localhost:3000
```

The dashboard reads `data/derived/impact-report.json` — pre-computed at build time so the page
loads from a static JSON and the <10s load requirement is trivially satisfied.

## Project layout

```
app/                      Next.js 15 App Router — the dashboard page
components/               UI primitives (engineer cards, radar chart, methodology panel)
lib/                      Shared types (types.ts) and scoring math (scoring.ts)
scripts/                  Offline pipeline
  01-fetch-github.ts      Pull PRs + reviews + issues from PostHog
  02-score-prs.ts         LLM-score PRs (Claude Haiku 4.5, schema-constrained, prompt-cached)
  03-compute-impact.ts    Combine into ImpactReport, rank, write derived JSON
data/cache/               Raw fetched + scored data (gitignored)
data/derived/             Final impact-report.json consumed by the dashboard (gitignored)
```

## Why this design

Weave's own product premise is that semantic PR understanding beats activity counters. The take-home
explicitly warns that counting lines/commits/reviews "does not define someone's impact" and that
"obscure scoring without explanation" is a red flag. The Impact Tensor handles both:

- The LLM scoring captures the *semantic* part Weave cares about.
- The radar chart per engineer shows *how* they're impactful (pure shipper vs. mentor vs. architect)
  rather than reducing them to one rank.
- Every score is backed by linked PRs the reader can click into as evidence.

Research influences: Will Larson on engineering impact and Staff archetypes, Tanya Reilly on glue
work, the DX Core 4 (Speed/Effectiveness/Quality/Impact), Kent Beck & Gergely Orosz's critique of
McKinsey's productivity framework, and Weave's own published methodology on quality-adjusted output
and code-review depth analysis.
