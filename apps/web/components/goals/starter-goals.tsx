"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { addStarterGoal } from "@/app/goals/starter-actions";
import { hm } from "@/lib/format";
import type { StarterGoal } from "@/lib/starter-goals";

const AREA: Record<StarterGoal["area"], string> = {
  business: "Business",
  health: "Health",
  personal: "Personal",
};

/**
 * Goals with none yet (#478): three goals, one per area, each kept in one tap with its weekly
 * budget. The hours change later on the goal's own row.
 */
export function StarterGoals({ starters }: { starters: StarterGoal[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <ul aria-label="Suggested goals" className="mt-1 overflow-hidden rounded-group bg-bg">
        {starters.map((s, i) => (
          <li key={s.key} className="relative flex min-h-14 items-center gap-3 pr-3">
            {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
            <span className="min-w-0 flex-1 py-2.5 pl-4">
              <span className="block truncate text-body font-semibold">{s.title}</span>
              <span className="block text-footnote text-label-2 tnum">
                {hm(s.minutes)} a week · {AREA[s.area]}
              </span>
            </span>
            <button
              type="button"
              disabled={adding !== null}
              aria-busy={adding === s.key}
              aria-label={`Add ${s.title}`}
              onClick={async () => {
                setAdding(s.key);
                setError(null);
                try {
                  const res = await addStarterGoal(s.key);
                  if (!res.ok) setError(res.message ?? "I could not save that goal. Nothing changed.");
                  else startTransition(() => router.refresh());
                } catch {
                  setError("I lost the line. Nothing changed.");
                } finally {
                  setAdding(null);
                }
              }}
              className="press flex h-9 shrink-0 items-center rounded-full bg-tint/14 px-4 text-subhead font-semibold text-tint-text disabled:opacity-60"
            >
              {adding === s.key ? "Adding" : "Add"}
            </button>
          </li>
        ))}
      </ul>
      <p role="alert" className="min-h-0 text-subhead text-danger empty:hidden">
        {error}
      </p>
    </>
  );
}
