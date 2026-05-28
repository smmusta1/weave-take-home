import type { ImpactReport } from "@/lib/types";

export function MethodologyPanel({ methodology }: { methodology: ImpactReport["methodology"] }) {
  return (
    <details
      open
      className="group rounded-2xl border border-neutral-200 bg-white p-5 open:shadow-sm"
    >
      <summary className="flex cursor-pointer items-center justify-between text-lg font-semibold">
        How impact is scored
        <span className="text-xs font-normal text-neutral-500 group-open:hidden">expand ↓</span>
        <span className="hidden text-xs font-normal text-neutral-500 group-open:inline">
          collapse ↑
        </span>
      </summary>

      <p className="mt-3 text-sm leading-relaxed text-neutral-700">{methodology.summary}</p>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {methodology.axes.map((axis) => (
          <div key={axis.name} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{axis.name}</div>
              <div className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 ring-1 ring-neutral-200">
                w={axis.weight}
              </div>
            </div>
            <div className="mt-1 text-xs leading-relaxed text-neutral-600">{axis.description}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg bg-neutral-900 px-3 py-2 font-mono text-xs text-neutral-100">
        score = (Output · 0.5 + Leverage · 0.5) · Durability
      </div>

      {methodology.caveats.length > 0 ? (
        <div className="mt-4">
          <div className="text-sm font-semibold">What this dashboard doesn&apos;t capture</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-neutral-700">
            {methodology.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  );
}
