import { CATEGORY_TITLE } from "@/lib/categories";
import { AREA_ORDER, type Balance, verdict } from "@/lib/gamification";

/**
 * The balanced week (#168): each area's score against its floor. Under the floor reads like lost
 * time (grey, hatched); at or above it, solid. The black tick is the floor. Pink stays goal time.
 */
export function BalanceBars({ balance }: { balance: Balance }) {
  const v = verdict(balance);
  return (
    <div className="flex flex-col gap-3">
      {v.line ? <p className="text-body font-semibold">{v.line}</p> : null}
      <ul className="flex flex-col gap-2.5">
        {AREA_ORDER.map((a) => {
          const score = balance.areas[a];
          const floor = balance.floors[a];
          const under = score < floor;
          return (
            <li key={a} className="grid grid-cols-[76px_minmax(0,1fr)_40px] items-center gap-3">
              <span className="text-subhead">{CATEGORY_TITLE[a]}</span>
              <span
                role="img"
                aria-label={`${CATEGORY_TITLE[a]} ${score}%, floor ${floor}%`}
                className="relative h-2.5 rounded-full bg-[color-mix(in_srgb,var(--m-context)_55%,transparent)]"
              >
                <span
                  className={`absolute inset-y-0 left-0 rounded-full ${
                    under ? "hatch bg-bg shadow-[inset_0_0_0_1px_var(--m-label-2)]" : "bg-label"
                  }`}
                  style={{ width: `${Math.max(3, Math.min(100, score))}%` }}
                />
                <span
                  className="absolute -top-1 h-[18px] w-[2px] -translate-x-1/2 rounded-full bg-label"
                  style={{ left: `${floor}%` }}
                />
              </span>
              <span className={`text-right text-subhead tnum ${under ? "text-label-2" : "font-semibold"}`}>
                {score}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
