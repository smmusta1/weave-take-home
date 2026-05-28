/**
 * Combine raw GitHub data + LLM PR scores → ImpactReport.
 *
 * Steps:
 *   1. Load data/cache/prs.json + data/cache/llm-scores.json + file-touch-frequency map.
 *   2. Build review graph (reviewer → author, weighted by review depth).
 *   3. PageRank via graphology-pagerank → leverage component.
 *   4. Sum LLM expert-hours × category weight per author (cap per PR) → output component.
 *   5. Compute % authored lines surviving 60d → durability multiplier.
 *   6. combineImpact() → totalScore. Rank, take top 5.
 *   7. For each top-5: assemble narrative (LLM, one-shot) + top-3 PR evidence + archetype label.
 *   8. Write data/derived/impact-report.json.
 *
 * TODO during timer.
 */
async function main() {
  throw new Error("not implemented — fill in during 90-min timer");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
