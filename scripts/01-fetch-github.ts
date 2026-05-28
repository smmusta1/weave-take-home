/**
 * Pull PRs + reviews + linked issues for TARGET_OWNER/TARGET_REPO over WINDOW_DAYS.
 * Persist raw responses under data/cache/ for resumable runs.
 *
 * Strategy:
 *   - GraphQL for batched PR-with-reviews fetch (cheaper than REST).
 *   - Page until createdAt < (now - WINDOW_DAYS).
 *   - On any 5xx / rate limit, sleep + retry with backoff.
 *
 * TODO during timer:
 *   - Implement GraphQL paginated fetch.
 *   - Compute repo-wide file touch frequency over the past 12 months for criticality proxy.
 *   - Write canonical PullRequest[] JSON to data/cache/prs.json.
 */
async function main() {
  throw new Error("not implemented — fill in during 90-min timer");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
