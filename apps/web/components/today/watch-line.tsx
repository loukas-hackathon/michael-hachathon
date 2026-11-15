import type { Event, Goal } from "@michael/shared";
import { get } from "@/lib/api";
import { athensDay, dayBounds } from "@/lib/athens";
import { formatTime, hm } from "@/lib/format";
import { healthOf, sleepAgainstGoal, workoutParts } from "@/lib/health";
import { USE_MOCKS } from "@/lib/mode";
import { sleepGoalMinutes } from "@/lib/sleep-goal";
import { Fold } from "./fold";

const iso = (ms: number) => new Date(ms).toISOString();

/** Today's sleep and workouts. One path, so Today can start the same request early (#221). */
export function watchTimelinePath(): string {
  const { start, end } = dayBounds(athensDay());
  return `/v1/timeline?${new URLSearchParams({ from: iso(start), to: iso(end), type: "sleep,workout" })}`;
}

/**
 * The watch on Today, a quiet row under "More from Michael" (#208): last night against the Sleep
 * goal, today's naps and today's workout. Last night follows the night rule in lib/health.ts: the
 * night you woke up from today, whenever you went to bed, and never a nap.
 * Fetches its own data (sleep and workouts only, a few rows) so Today's page stays one line.
 * Says nothing on the sample previews, while mocks are on, or when the watch has nothing to say.
 */
export async function WatchLine({ demo }: { demo?: string }) {
  if (demo || USE_MOCKS) return null;
  const { start, end } = dayBounds(athensDay());
  const [timeline, goals] = await Promise.all([
    get<{ events: Event[] }>(watchTimelinePath()).catch(() => ({ events: [] as Event[] })),
    get<{ goals: Goal[] }>("/v1/goals").catch(() => ({ goals: [] as Goal[] })),
  ]);
  const health = healthOf(timeline.events, start, end);
  const night = health.lastNight;
  const workouts = health.workouts;
  const naps = health.naps;
  if (!night && workouts.length === 0 && naps.length === 0) return null;
  const verdict = night ? sleepAgainstGoal(night.minutes, sleepGoalMinutes(goals.goals)) : null;

  return (
    <Fold
      wideOpen
      title="From the watch"
      label="From the watch"
      preview={[
        night ? `${hm(night.minutes)} sleep${verdict ? `, ${verdict}` : ""}` : null,
        ...naps.map((n) => `Nap ${hm(n.minutes)}`),
        ...workouts.map((w) => `${w.name} ${hm(w.minutes)}`),
      ]
        .filter(Boolean)
        .join(". ")
        .concat(".")}
    >
      <div className="space-y-1 text-subhead text-label-2 tnum">
        {night ? (
          <p className="flex items-baseline gap-2">
            <span aria-hidden="true" className="dots inline-block h-2.5 w-3 shrink-0 rounded-[3px] bg-bg" />
            <span>
              <b className="font-semibold text-label">{hm(night.minutes)}</b> sleep
              {verdict ? `, ${verdict}` : ""}.{" "}
              <span className="text-footnote">
                {formatTime(iso(night.start))} to {formatTime(iso(night.end))}
              </span>
            </span>
          </p>
        ) : null}
        {naps.map((n) => (
          <p key={n.start} className="flex items-baseline gap-2">
            <span aria-hidden="true" className="dots inline-block h-2.5 w-3 shrink-0 rounded-[3px] bg-bg" />
            <span>
              <b className="font-semibold text-label">Nap</b> {hm(n.minutes)}, outside the Sleep goal.{" "}
              <span className="text-footnote">{formatTime(iso(n.start))}</span>
            </span>
          </p>
        ))}
        {workouts.map((w) => (
          <p key={w.start} className="flex items-baseline gap-2">
            <span aria-hidden="true" className="inline-block h-2.5 w-3 shrink-0 rounded-[3px] bg-label-2" />
            <span>
              <b className="font-semibold text-label">{w.name}</b> {workoutParts(w).join(", ")}.{" "}
              <span className="text-footnote">{formatTime(iso(w.start))}</span>
            </span>
          </p>
        ))}
      </div>
    </Fold>
  );
}
