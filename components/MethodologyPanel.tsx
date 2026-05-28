import type { ImpactReport } from "@/lib/types";

export function MethodologyPanel({ methodology }: { methodology: ImpactReport["methodology"] }) {
  return (
    <details className="rounded-2xl border border-neutral-200 bg-white p-5">
      <summary className="cursor-pointer text-lg font-semibold">How impact is scored</summary>
      <p className="mt-3 text-sm text-neutral-700">{methodology.summary}</p>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {methodology.axes.map((axis) => (
          <div key={axis.name} className="rounded-lg bg-neutral-50 p-3">
            <div className="text-sm font-semibold">
              {axis.name} <span className="text-neutral-400">· w={axis.weight}</span>
            </div>
            <div className="mt-1 text-xs text-neutral-600">{axis.description}</div>
          </div>
        ))}
      </div>
      {methodology.caveats.length > 0 ? (
        <div className="mt-4">
          <div className="text-sm font-semibold">Caveats</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-neutral-700">
            {methodology.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  );
}
