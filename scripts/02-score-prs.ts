/**
 * LLM-score PRs for quality-adjusted output (Weave-style).
 *
 * Strategy:
 *   - Identify top ~30 candidate engineers by raw PR + review count.
 *   - For each, send their top K PRs (by changedFiles + body length) to Claude Haiku 4.5.
 *   - Schema-constrained tool-call returning LLMPRScore.
 *   - Cache by PR number to data/cache/scores/<prNumber>.json.
 *   - p-limit concurrency = 8; prompt-cache the system message.
 *
 * TODO during timer:
 *   - Write the system prompt that defines expert_hours calibration.
 *   - Implement tool-call schema for LLMPRScore.
 *   - Run, write data/cache/llm-scores.json.
 */
async function main() {
  throw new Error("not implemented — fill in during 90-min timer");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
