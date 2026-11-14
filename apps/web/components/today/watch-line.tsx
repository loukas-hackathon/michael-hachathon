import type { Event, Goal } from "@michael/shared";
import { get, usingMocks } from "@/lib/api";
import { athensDay, dayBounds } from "@/lib/athens";
import { formatTime, hm } from "@/lib/format";
import { healthOf, sleepAgainstGoal, sleepGoalMinutes, workoutParts } from "@/lib/health";

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The watch on Today, two quiet lines: last night against the Sleep goal, and today's workout.
 * Fetches its own data (sleep and workouts only, a few rows) so Today's page stays one line.
 * Says nothing on the sample previews, while mocks are on, or when the watch has nothing to say.
 */
export async function WatchLine({ demo }: { demo?: string }) {
  if (demo || usingMocks()) return null;
  const { start, end } = dayBounds(athensDay());
  const qs = new URLSearchParams({ from: iso(start), to: iso(end), type: "sleep,workout" });
  const [timeline, goals] = await Promise.all([
    get<{ events: Event[] }>(`/v1/timeline?${qs}`).catch(() => ({ events: [] as Event[] })),
    get<{ goals: Goal[] }>("/v1/goals").catch(() => ({ goals: [] as Goal[] })),
  ]);
  const health = healthOf(timeline.events, start, end);
  const night = health.lastNight;
  const workouts = health.workouts;
  if (!night && workouts.length === 0) return null;
  const verdict = night ? sleepAgainstGoal(night.minutes, sleepGoalMinutes(goals.goals)) : null;

  return (
    <section aria-label="From the watch" className="mt-3 space-y-1 text-subhead text-label-2 tnum">
      {night ? (
        <p className="flex items-baseline gap-2">
          <span aria-hidden="true" className="dots inline-block h-2.5 w-3 shrink-0 rounded-[3px] bg-fill" />
          <span>
            <b className="font-semibold text-label">{hm(night.minutes)}</b> sleep
            {verdict ? `, ${verdict}` : ""}.{" "}
            <span className="text-footnote">
              {formatTime(iso(night.start))} to {formatTime(iso(night.end))}
            </span>
          </span>
        </p>
      ) : null}
      {workouts.map((w) => (
        <p key={w.start} className="flex items-baseline gap-2">
          <span aria-hidden="true" className="inline-block h-2.5 w-3 shrink-0 rounded-[3px] bg-label-2" />
          <span>
            <b className="font-semibold text-label">{w.name}</b> {workoutParts(w).join(", ")}.{" "}
            <span className="text-footnote">{formatTime(iso(w.start))}</span>
          </span>
        </p>
      ))}
    </section>
  );
}
