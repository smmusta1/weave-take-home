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
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">PostHog · Top 5 Engineers</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {report.window.startISO} → {report.window.endISO} · {report.window.prCount} PRs ·{" "}
          {report.window.engineerCount} contributors
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {report.topEngineers.map((eng, i) => (
          <EngineerCard key={eng.login} engineer={eng} rank={i + 1} />
        ))}
      </section>

      <section className="mt-10">
        <MethodologyPanel methodology={report.methodology} />
      </section>
    </main>
  );
}
