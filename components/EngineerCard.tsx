import type { EngineerImpact } from "@/lib/types";
import { ImpactRadar } from "./ImpactRadar";

export function EngineerCard({ engineer, rank }: { engineer: EngineerImpact; rank: number }) {
  return (
    <article className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">
          {rank}
        </div>
        {engineer.avatarUrl ? (
          <img src={engineer.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
        ) : null}
        <div>
          <div className="font-semibold">{engineer.name ?? engineer.login}</div>
          <div className="text-xs text-neutral-500">@{engineer.login} · {engineer.archetype}</div>
        </div>
      </div>

      <div className="mt-4">
        <ImpactRadar
          output={engineer.output}
          leverage={engineer.leverage}
          durability={engineer.durability}
        />
      </div>

      <p className="mt-3 text-sm leading-snug text-neutral-700">{engineer.narrative}</p>

      <div className="mt-3 border-t border-neutral-100 pt-3">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Evidence
        </div>
        <ul className="space-y-1 text-xs">
          {engineer.topPRs.map((pr) => (
            <li key={pr.number} className="truncate">
              <a className="text-blue-700 hover:underline" href={pr.url} target="_blank" rel="noreferrer">
                #{pr.number}
              </a>
              <span className="ml-1 text-neutral-700">{pr.title}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
