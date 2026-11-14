import { formatTime, hm } from "@/lib/format";
import { type HeartPoint, type Night, sleepAgainstGoal, workoutParts } from "@/lib/health";
import { type Block, makeY, type TimelineDay } from "@/lib/timeline";
import { HeartToggle } from "./heart-toggle";

const PER_HOUR = 56;
const QUIET = 32;
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function blockMeta(b: Block) {
  const parts = [hm(b.minutes)];
  const breaks = [
    ...b.cuts.map((c) => c.minutes),
    ...(b.lostStretches ?? []).map((l) => (l.end - l.start) / 60_000),
  ];
  if (breaks.length > 0) {
    const lost = breaks.reduce((n, m) => n + m, 0);
    parts.push(`${breaks.length} ${breaks.length === 1 ? "interruption" : "interruptions"}, ${hm(lost)}`);
  }
  return parts.join(" · ");
}

/**
 * The day, hour by hour (docs/design-guide.md, "Timeline"). Time flows down. Pink is goal time,
 * hatched is time lost, grey is everything else. Interruptions cut a block's right edge.
 * Phone sessions run down the right edge, Claude Code sessions down the left.
 */
export function DayTimeline({
  day,
  heartHidden = false,
}: {
  day: TimelineDay;
  /** The heart rate lane starts hidden (the viewer turned it off). */
  heartHidden?: boolean;
}) {
  const y = makeY(day.segments, PER_HOUR, QUIET);
  const health = day.health;
  const nights = [health?.lastNight, health?.tonight].filter((n): n is Night => Boolean(n));
  const workouts = health?.workouts ?? [];
  const heart = health?.heart ?? [];
  const height = y(day.dayEnd);
  const plans = day.plans ?? [];
  const hours: number[] = [];
  for (const s of day.segments) {
    if (s.kind !== "hours") continue;
    for (let h = s.from; h <= s.to; h += HOUR) hours.push(h);
  }

  // Loss labels never collide: each keeps clear of its block's title lines and of the label above.
  const lossLabels: { key: string; top: number; text: string }[] = [];
  let lastLabel = Number.NEGATIVE_INFINITY;
  for (const b of day.blocks) {
    const top = y(b.start);
    const titleUntil = y(b.end) - top >= 36 ? top + 38 : y(b.end) - top >= 17 ? top + 20 : top;
    for (const l of b.lostStretches ?? []) {
      const ly = y(l.start) + (y(l.end) - y(l.start)) / 2 - 7;
      if (ly < titleUntil || ly - lastLabel < 16) continue;
      lossLabels.push({ key: `ll${l.start}`, top: ly, text: `${l.what} ${hm((l.end - l.start) / 60_000)}` });
      lastLabel = ly;
    }
  }

  return (
    <div
      id={TIMELINE_ID}
      data-hr={heart.length > 1 && !heartHidden ? "on" : "off"}
      className="group/tl relative mt-3 tnum [--lane-r:16px] data-[hr=on]:[--lane-r:44px]"
      style={{ height }}
    >
      {/* Quiet stretches, collapsed. */}
      {day.segments.map((s) =>
        s.kind === "quiet" ? (
          <div
            key={`q${s.from}`}
            className="dots absolute inset-x-0 flex items-center justify-between rounded-block bg-fill px-2.5 text-footnote text-label-2"
            style={{ top: y(s.from) + 3, height: QUIET - 6 }}
          >
            <span>
              {formatTime(iso(s.from))} to{" "}
              {s.to - s.from >= 24 * HOUR - 60_000 ? "24:00" : formatTime(iso(s.to))}
            </span>
            <span>{nights.some((n) => n.start < s.to && n.end > s.from) ? "Asleep" : "No screens"}</span>
          </div>
        ) : null,
      )}

      {/* Hour rules. */}
      {hours.map((h) => (
        <div
          key={`h${h}`}
          className="absolute inset-x-0 border-t-[0.5px] border-separator"
          style={{ top: y(h) }}
        >
          <span className="absolute -top-[7px] left-0 bg-bg pr-1 text-caption font-medium text-label-2">
            {formatTime(iso(h))}
          </span>
        </div>
      ))}

      {/* Claude Code lane. */}
      {day.ai.map((m) => (
        <span
          key={`a${m.start}`}
          className="absolute left-[42px] w-[3px] rounded-full bg-label opacity-40"
          style={{ top: y(m.start), height: Math.max(3, y(m.end) - y(m.start)) }}
        />
      ))}

      {/* Planned outlines first, then what happened on top. Michael's own blocks are outlined in tint. */}
      {plans.map((p) => (
        <div
          key={`cal${p.start}${p.title}`}
          className={`absolute right-(--lane-r) left-[50px] rounded-block border-[1.5px] border-dashed ${
            p.michael ? "border-tint" : "border-label-2"
          }`}
          style={{ top: y(p.start), height: Math.max(4, y(p.end) - y(p.start)) }}
          title={`${p.title}, ${formatTime(iso(p.start))} to ${formatTime(iso(p.end))}`}
        />
      ))}
      {day.blocks.map((b) =>
        b.plan ? (
          <div
            key={`p${b.plan.start}`}
            className="absolute right-(--lane-r) left-[50px] rounded-block border-[1.5px] border-dashed border-label-2"
            style={{ top: y(b.plan.start), height: Math.max(4, y(b.plan.end) - y(b.plan.start)) }}
          />
        ) : null,
      )}

      {day.blocks.map((b) => {
        if (b.end <= b.start) return null;
        const top = y(b.start);
        const h = Math.max(3, y(b.end) - top);
        const fill =
          b.kind === "work"
            ? "bg-spark"
            : b.kind === "lost"
              ? "hatch bg-bg shadow-[inset_0_0_0_1px_var(--m-label-2)]"
              : "bg-fill";
        const ink = b.kind === "work" ? "text-[#000]" : "text-label";
        return (
          <div key={`b${b.start}`}>
            <div
              data-live-key={`b${b.kind}${b.start}-${b.end}`}
              className={`absolute right-(--lane-r) left-[50px] overflow-hidden rounded-block ${fill}`}
              style={{ top, height: h }}
              title={`${b.label}, ${formatTime(iso(b.start))} to ${formatTime(iso(b.end))}`}
            >
              {b.cuts.length > 0 ? (
                <span className="absolute top-0 right-3 bottom-0 w-[0.5px] bg-[rgb(0_0_0/0.2)]" />
              ) : null}
              {b.cuts.map((c) => (
                <span
                  key={`c${c.at}`}
                  className="absolute right-0 w-3 bg-bg"
                  style={{ top: y(c.at) - top, height: Math.max(2, (c.minutes / 60) * PER_HOUR) }}
                />
              ))}
              {b.lostStretches?.map((l) => (
                <span
                  key={`l${l.start}`}
                  className="hatch absolute inset-x-0 bg-bg"
                  style={{ top: y(l.start) - top, height: Math.max(3, y(l.end) - y(l.start)) }}
                />
              ))}
              {h >= 17 ? (
                <p
                  className={`absolute top-1 right-5 left-2 truncate text-footnote leading-4 font-semibold ${ink}`}
                >
                  {b.kind === "lost" ? (
                    <span className="rounded-[4px] bg-bg px-1">
                      {b.label} {hm(b.minutes)}
                    </span>
                  ) : (
                    b.label
                  )}
                </p>
              ) : null}
              {h >= 36 && b.kind !== "lost" ? (
                <p
                  className={`absolute top-[21px] right-5 left-2 truncate text-[12px] leading-4 font-medium opacity-80 ${ink}`}
                >
                  {blockMeta(b)}
                </p>
              ) : null}
            </div>
            {b.plan && b.movedEnd ? (
              <>
                <div
                  className="absolute right-(--lane-r) left-[50px] rounded-b-block border-[1.5px] border-dashed border-tint"
                  style={{ top: y(b.plan.end), height: Math.max(6, y(b.movedEnd) - y(b.plan.end)) }}
                />
                <span
                  className="absolute left-[50px] text-caption font-semibold text-tint-text"
                  style={{ top: y(b.movedEnd) + 3 }}
                >
                  I moved the end to {formatTime(iso(b.movedEnd))}
                </span>
              </>
            ) : null}
          </div>
        );
      })}

      {/* Workouts from the watch: goal time, so pink, with what it was and how hard. */}
      {workouts.map((w) => {
        const top = y(Math.max(w.start, day.dayStart));
        const h = Math.max(3, y(Math.min(w.end, day.dayEnd)) - top);
        return (
          <div
            key={`w${w.start}`}
            data-live-key={`w${w.start}-${w.end}`}
            className="absolute right-(--lane-r) left-[50px] overflow-hidden rounded-block bg-spark"
            style={{ top, height: h }}
            title={`${w.name}, ${formatTime(iso(w.start))} to ${formatTime(iso(w.end))}`}
          >
            {h >= 17 ? (
              <p className="absolute top-1 right-2 left-2 truncate text-footnote leading-4 font-semibold text-[#000]">
                {w.name}
              </p>
            ) : null}
            {h >= 36 ? (
              <p className="absolute top-[21px] right-2 left-2 truncate text-[12px] leading-4 font-medium text-[#000] opacity-80">
                {workoutParts(w).join(" · ")}
              </p>
            ) : null}
          </div>
        );
      })}

      {/* Plan titles where nothing happened over their first lines, and Michael's marker always. */}
      {plans.map((p) => {
        const top = y(p.start);
        const h = y(p.end) - top;
        const covered = [...day.blocks, ...workouts].some((b) => y(b.start) < top + 18 && y(b.end) > top + 2);
        return (
          <div key={`calt${p.start}${p.title}`}>
            {!covered && h >= 17 ? (
              <p
                className="absolute right-[calc(var(--lane-r)+60px)] left-[58px] truncate text-footnote leading-4 font-semibold text-label-2"
                style={{ top: top + 4 }}
              >
                {p.title}
              </p>
            ) : null}
            {p.michael ? (
              <span
                className="absolute right-[calc(var(--lane-r)+6px)] rounded-[4px] bg-bg px-1 text-caption font-semibold text-tint-text"
                style={{ top: top + (h >= 17 ? 3 : -8) }}
              >
                Michael
              </span>
            ) : null}
          </div>
        );
      })}

      {/* Drives: the empty road in grey, the traffic on top hatched, as time lost. */}
      {(day.drives ?? []).map((d) => {
        const top = y(d.start);
        const h = Math.max(4, y(d.end) - top);
        const trafficH = (d.trafficMinutes / Math.max(1, d.minutes)) * h;
        return (
          <div
            key={`d${d.start}`}
            className="absolute right-(--lane-r) left-[50px] overflow-hidden rounded-block bg-fill"
            style={{ top, height: h }}
            title={`Drive to ${d.to}, ${d.minutes} minutes, ${d.trafficMinutes} in traffic`}
          >
            {trafficH > 0 ? (
              <span
                className="hatch absolute inset-x-0 bottom-0 bg-bg shadow-[inset_0_0_0_1px_var(--m-label-2)]"
                style={{ height: trafficH }}
              />
            ) : null}
            {h >= 17 ? (
              <p className="absolute top-1 right-2 left-2 flex items-center justify-between gap-2 text-footnote leading-4 font-semibold">
                <span className="truncate">
                  Drive to {d.to} · {d.minutes}&nbsp;min
                </span>
                {d.trafficMinutes > 0 ? (
                  <span className="shrink-0 rounded-[4px] bg-bg px-1 text-caption">
                    Traffic {d.trafficMinutes}&nbsp;min
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
        );
      })}

      {lossLabels.map((l) => (
        <span
          key={l.key}
          className="absolute right-[calc(var(--lane-r)+6px)] rounded-[4px] bg-bg px-1 text-caption font-semibold text-label"
          style={{ top: l.top }}
        >
          {l.text}
        </span>
      ))}

      {heart.length > 1 ? <HeartLane points={heart} y={y} height={height} /> : null}

      {/* Phone lane. */}
      {day.phone.map((m) => (
        <span
          key={`m${m.start}`}
          className="absolute right-0.5 w-2 rounded-[1px] bg-label-2"
          style={{ top: y(m.start), height: Math.max(2, y(m.end) - y(m.start)) }}
        />
      ))}

      {day.now ? (
        <div
          className="absolute right-0 left-[34px] border-t-[1.5px] border-label"
          style={{ top: y(day.now) }}
        >
          <span className="absolute -top-[11px] -left-[34px] rounded-full bg-label px-1.5 py-[3px] text-caption font-bold text-bg">
            {formatTime(iso(day.now))}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** The day's container: the heart rate toggle in the key flips its data-hr. */
export const TIMELINE_ID = "day-timeline";

/**
 * A night from the watch, collapsed to one calm row with the dot texture: when, how long, and the
 * Sleep goal's verdict. Last night sits above the day, tonight below it.
 */
export function SleepBand({
  night,
  goal,
  tonight = false,
}: {
  night: Night;
  goal: number | null;
  tonight?: boolean;
}) {
  const verdict = sleepAgainstGoal(night.minutes, goal);
  return (
    <div
      className={`dots flex items-center justify-between gap-3 rounded-block bg-fill px-2.5 py-1.5 text-footnote text-label-2 tnum ${
        tonight ? "mt-2" : "mt-3"
      }`}
    >
      <span className="min-w-0">
        <span className="font-semibold text-label">Sleep</span> {formatTime(iso(night.start))} to{" "}
        {formatTime(iso(night.end))}
        <span className="sr-only">, {tonight ? "tonight" : "last night"}</span>
      </span>
      <span className="shrink-0 text-right">
        <b className="font-semibold text-label">{hm(night.minutes)}</b>
        {verdict ? `, ${verdict.replace(/ (of )?your goal$/, "")}` : ""}
      </span>
    </div>
  );
}

/**
 * Heart rate per hour as a quiet vertical line in its own lane, between the blocks and the phone
 * ticks. Higher is further left. Hours without a reading break the line.
 */
function HeartLane({
  points,
  y,
  height,
}: {
  points: HeartPoint[];
  y: (x: number) => number;
  height: number;
}) {
  const lo = Math.min(...points.map((p) => p.avg));
  const hi = Math.max(...points.map((p) => p.avg));
  const W = 24;
  const x = (v: number) => (hi === lo ? W / 2 : 3 + ((hi - v) / (hi - lo)) * (W - 6));
  const runs: HeartPoint[][] = [];
  for (const p of points) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run && last && p.at - last.at <= HOUR + 60_000) run.push(p);
    else runs.push([p]);
  }
  const peak = points.reduce((a, b) => (b.avg > a.avg ? b : a));
  return (
    <svg
      aria-label={`Heart rate, ${Math.round(lo)} to ${Math.round(hi)} bpm an hour on average`}
      role="img"
      className="pointer-events-none absolute top-0 right-3 overflow-visible text-label-2 group-data-[hr=off]/tl:hidden"
      width={W}
      height={height}
    >
      {runs.map((r) => {
        const first = r[0] as HeartPoint;
        return r.length === 1 ? (
          <circle key={`hr${first.at}`} cx={x(first.avg)} cy={y(first.at)} r={1.5} fill="currentColor" />
        ) : (
          <polyline
            key={`hr${first.at}`}
            points={r.map((p) => `${x(p.avg).toFixed(1)},${y(p.at).toFixed(1)}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={x(peak.avg)} cy={y(peak.at)} r={2} fill="currentColor" />
    </svg>
  );
}

/** Key for the lanes, shown once above the day. */
export function TimelineKey({
  hasAi,
  hasPlan,
  goalTime = hasPlan,
  hasMichael = false,
  hasDrives = false,
  day,
  heartHidden = false,
}: {
  /** The day, for the watch's entries (workouts, heart rate). */
  day?: TimelineDay;
  heartHidden?: boolean;
  hasAi: boolean;
  hasPlan: boolean;
  /** Planned drives on the day (travel events). */
  hasDrives?: boolean;
  /** Pink means goal time against a plan (the sample day); otherwise it is time in work apps. */
  goalTime?: boolean;
  hasMichael?: boolean;
}) {
  const item = "inline-flex items-center gap-1.5";
  const hasWorkouts = (day?.health?.workouts.length ?? 0) > 0;
  const heart = day?.health?.heart ?? [];
  const lo = heart.length > 1 ? Math.round(Math.min(...heart.map((p) => p.avg))) : 0;
  const hi = heart.length > 1 ? Math.round(Math.max(...heart.map((p) => p.avg))) : 0;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-footnote text-label-2">
      {hasPlan ? (
        <li className={item}>
          <span className="h-3 w-4 rounded-[3px] border-[1.5px] border-dashed border-label-2" />
          Planned
        </li>
      ) : null}
      {hasMichael ? (
        <li className={item}>
          <span className="h-3 w-4 rounded-[3px] border-[1.5px] border-dashed border-tint" />
          Booked by Michael
        </li>
      ) : null}
      <li className={item}>
        <span className="h-3 w-4 rounded-[3px] bg-spark" />
        {goalTime ? "Goal time" : hasWorkouts ? "Work apps, workouts" : "Work apps"}
      </li>
      <li className={item}>
        <span className="hatch h-3 w-4 rounded-[3px] shadow-[inset_0_0_0_1px_var(--m-label-2)]" />
        Lost
      </li>
      {goalTime ? null : (
        <li className={item}>
          <span className="h-3 w-4 rounded-[3px] bg-fill shadow-[inset_0_0_0_0.5px_var(--m-separator)]" />
          Other
        </li>
      )}
      {hasDrives ? (
        <li className={item}>
          <span className="h-3 w-4 rounded-[3px] bg-fill shadow-[inset_0_0_0_0.5px_var(--m-separator)]" />
          Drive
        </li>
      ) : null}
      <li className={item}>
        <span className="h-3 w-1.5 rounded-[1px] bg-label-2" />
        Phone
      </li>
      {hasAi ? (
        <li className={item}>
          <span className="h-3 w-[3px] rounded-full bg-label opacity-40" />
          Claude Code
        </li>
      ) : null}
      {heart.length > 1 ? (
        <li className={item}>
          <HeartToggle target={TIMELINE_ID} hidden={heartHidden} range={`${lo} to ${hi}`} />
        </li>
      ) : null}
    </ul>
  );
}
