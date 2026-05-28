import type { EngineerImpact } from "@/lib/types";
import { ImpactRadar } from "./ImpactRadar";

const ARCHETYPE_TINT: Record<EngineerImpact["archetype"], string> = {
  "Tech Lead": "bg-indigo-50 text-indigo-700 ring-indigo-200",
  Architect: "bg-amber-50 text-amber-700 ring-amber-200",
  Solver: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Glue: "bg-rose-50 text-rose-700 ring-rose-200",
  Shipper: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function EngineerCard({ engineer, rank }: { engineer: EngineerImpact; rank: number }) {
  return (
    <article className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">
          {rank}
        </div>
        {engineer.avatarUrl ? (
          <img src={engineer.avatarUrl} alt="" className="h-9 w-9 rounded-full" />
        ) : (
          <div className="h-9 w-9 rounded-full bg-neutral-200" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {engineer.name ?? engineer.login}
          </div>
          <div className="truncate text-xs text-neutral-500">@{engineer.login}</div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${ARCHETYPE_TINT[engineer.archetype]}`}
        >
          {engineer.archetype}
        </span>
        <span className="text-[11px] tabular-nums text-neutral-500">
          score <span className="font-semibold text-neutral-900">{engineer.totalScore.toFixed(1)}</span>
        </span>
      </div>

      <div className="mt-2">
        <ImpactRadar
          output={engineer.output}
          leverage={engineer.leverage}
          durability={(engineer.durability - 0.5) * 100}
        />
      </div>

      <div className="mt-1 grid grid-cols-3 gap-1 text-center text-[10px]">
        <Axis label="Output" value={engineer.output} />
        <Axis label="Leverage" value={engineer.leverage} />
        <Axis label="Dura" value={(engineer.durability - 0.5) * 100} />
      </div>

      <p className="mt-3 text-xs leading-snug text-neutral-700">{engineer.narrative}</p>

      <div className="mt-3 border-t border-neutral-100 pt-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Evidence PRs
        </div>
        <ul className="space-y-1 text-[11px]">
          {engineer.topPRs.map((pr) => (
            <li key={pr.number} className="flex gap-1">
              <a
                className="shrink-0 font-mono text-blue-700 hover:underline"
                href={pr.url}
                target="_blank"
                rel="noreferrer"
              >
                #{pr.number}
              </a>
              <span className="line-clamp-2 text-neutral-700">{pr.title}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1 border-t border-neutral-100 pt-2 text-center text-[10px]">
        <Stat label="authored" value={engineer.stats.prsAuthored} />
        <Stat label="reviewed" value={engineer.stats.prsReviewed} />
        <Stat label="mentored" value={engineer.stats.uniqueAuthorsReviewed} />
      </div>
    </article>
  );
}

function Axis({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-semibold tabular-nums text-neutral-900">{value.toFixed(0)}</div>
      <div className="text-neutral-500">{label}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-semibold tabular-nums text-neutral-900">{value}</div>
      <div className="text-neutral-500">{label}</div>
    </div>
  );
}
