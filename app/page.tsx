import { promises as fs } from "node:fs";
import path from "node:path";
import type { ImpactReport } from "@/lib/types";
import { EngineerCard } from "@/components/EngineerCard";
import { MethodologyPanel } from "@/components/MethodologyPanel";

async function loadReport(): Promise<ImpactReport | null> {
  const file = path.join(process.cwd(), "data/derived/impact-report.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as ImpactReport;
  } catch {
    return null;
  }
}

export default async function Page() {
  const report = await loadReport();

  if (!report) {
    return (
      <main className="mx-auto max-w-5xl p-10">
        <h1 className="text-2xl font-semibold">No report yet</h1>
        <p className="mt-2 text-neutral-600">
          Run <code className="rounded bg-neutral-200 px-1.5 py-0.5">npm run pipeline:all</code> to
          fetch PostHog data, score PRs, and compute the impact report.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-8">
      <header className="mb-8 flex items-end justify-between gap-6 border-b border-neutral-200 pb-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
            PostHog · Engineering Impact
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            The five most impactful engineers
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-600">
            Output × Leverage × Durability, calibrated on {report.window.prCount.toLocaleString()}{" "}
            merged PRs from {report.window.engineerCount} contributors between{" "}
            <span className="font-medium text-neutral-800">{report.window.startISO}</span> and{" "}
            <span className="font-medium text-neutral-800">{report.window.endISO}</span>.
          </p>
        </div>
        <a
          href={`https://github.com/PostHog/posthog`}
          target="_blank"
          rel="noreferrer"
          className="hidden text-xs text-neutral-500 hover:text-neutral-900 hover:underline md:block"
        >
          PostHog/posthog ↗
        </a>
      </header>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-5 lg:grid-cols-3 md:grid-cols-2">
        {report.topEngineers.map((eng, i) => (
          <EngineerCard key={eng.login} engineer={eng} rank={i + 1} />
        ))}
      </section>

      <section className="mt-8">
        <MethodologyPanel methodology={report.methodology} />
      </section>

      <footer className="mt-10 text-center text-xs text-neutral-400">
        Built for the Weave take-home. Click any PR link to verify the evidence in the source repo.
      </footer>
    </main>
  );
}
