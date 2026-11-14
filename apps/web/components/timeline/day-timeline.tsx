"use client";

import { type ReactNode, useState } from "react";
import { Sheet } from "@/components/sheet";
import { formatTime, hm, minutesPhrase, spokenDuration } from "@/lib/format";
import { type HeartPoint, type Night, sleepAgainstGoal, workoutParts } from "@/lib/health";
import {
  type Block,
  blockTitle,
  lostMinutesOf,
  makeY,
  type Plan,
  planFor,
  type TimelineDay,
} from "@/lib/timeline";
import { HeartToggle } from "./heart-toggle";

const PER_HOUR = 56;
const QUIET = 32;
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const span = (from: number, to: number) => `${formatTime(iso(from))} to ${formatTime(iso(to))}`;

type Picked = { kind: "block"; block: Block } | { kind: "plan"; plan: Plan };

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
 * The same day as a plain list for VoiceOver: one item per block, plan, workout and drive, in time
 * order, in full words ("09:00 to 10:30. Deep work, goal time, 1 hour 30 minutes, 2 interruptions").
 * The drawing's positions and textures mean nothing read aloud; its blocks stay buttons for detail.
 */
export function DayTimelineList({ day }: { day: TimelineDay }) {
  const KIND = { work: "goal time", lost: "time lost", other: "other activity" } as const;
  const when = (a: number, b: number) =>
    `${formatTime(iso(a))} to ${b - a >= 24 * HOUR - 60_000 ? "24:00" : formatTime(iso(b))}`;
  const plans = day.plans ?? [];
  const items: { at: number; key: string; text: string }[] = [];
  for (const b of day.blocks) {
    if (b.end <= b.start) continue;
    const { title } = blockTitle(b, plans);
    const parts = [`${title}, ${KIND[b.kind]}, ${spokenDuration(b.minutes)}`];
    const breaks = [
      ...b.cuts.map((c) => c.minutes),
      ...(b.lostStretches ?? []).map((l) => (l.end - l.start) / 60_000),
    ];
    if (b.kind !== "lost" && breaks.length > 0) {
      const lost = breaks.reduce((n, m) => n + m, 0);
      parts.push(
        `${breaks.length} ${breaks.length === 1 ? "interruption" : "interruptions"}, ${spokenDuration(lost)}`,
      );
    }
    if (b.movedEnd) parts.push(`I moved the end to ${formatTime(iso(b.movedEnd))}`);
    items.push({ at: b.start, key: `b${b.start}`, text: `${when(b.start, b.end)}. ${parts.join(", ")}.` });
  }
  for (const p of plans) {
    const who = `${p.michael ? ", booked by Michael" : ""}${p.withOthers ? ", with other people" : ""}`;
    items.push({
      at: p.start,
      key: `p${p.start}${p.title}`,
      text: `${when(p.start, p.end)}. Planned: ${p.title}${who}.`,
    });
  }
  for (const w of day.health?.workouts ?? []) {
    items.push({ at: w.start, key: `w${w.start}`, text: `${when(w.start, w.end)}. Workout: ${w.name}.` });
  }
  for (const d of day.drives ?? []) {
    const traffic = d.trafficMinutes > 0 ? `, ${spokenDuration(d.trafficMinutes)} in traffic` : "";
    items.push({
      at: d.start,
      key: `d${d.start}`,
      text: `${when(d.start, d.end)}. Drive to ${d.to}, ${spokenDuration(d.minutes)}${traffic}.`,
    });
  }
  for (const q of day.segments) {
    if (q.kind === "quiet")
      items.push({ at: q.from, key: `q${q.from}`, text: `${when(q.from, q.to)}. Nothing on screen.` });
  }
  items.sort((a, b) => a.at - b.at);
  return (
    <div className="sr-only">
      <ol aria-label="The day in order">
        {items.map((i) => (
          <li key={i.key}>{i.text}</li>
        ))}
      </ol>
      {day.phone.length > 0 ? (
        <p>
          {day.phone.length} phone {day.phone.length === 1 ? "session" : "sessions"},{" "}
          {spokenDuration(day.totals.phoneMinutes)} in all.
        </p>
      ) : null}
      {day.now != null ? <p>Now {formatTime(iso(day.now))}. Tap a block below for its detail.</p> : null}
    </div>
  );
}

/**
 * The day, hour by hour (docs/design-guide.md, "Timeline"). Time flows down. Pink is goal time,
 * hatched is time lost, grey is everything else. Interruptions cut a block's right edge.
 * Phone sessions run down the right edge, Claude Code sessions down the left.
 *
 * Every label sits on a solid chip of its block's colour, so hatching never runs through text, and
 * the hour labels step aside for the now pill. Tap a block for its detail sheet.
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
  const [picked, setPicked] = useState<Picked | null>(null);
  const height = y(day.dayEnd);
  const plans = day.plans ?? [];
  const nowY = day.now != null ? y(day.now) : null;
  // The collapsed rows print their own times, so the hour labels at their edges stay out.
  const edges = new Set(day.segments.flatMap((s) => (s.kind === "quiet" ? [s.from, s.to] : [])));
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
    <>
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
              aria-hidden="true"
              className="dots absolute inset-x-0 flex items-center justify-between rounded-block bg-fill px-2.5 text-footnote text-label-2"
              style={{ top: y(s.from) + 3, height: QUIET - 6 }}
            >
              <span>
                {formatTime(iso(s.from))} to{" "}
                {s.to - s.from >= 24 * HOUR - 60_000 ? "24:00" : formatTime(iso(s.to))}
              </span>
              <span>
                {nights.some((n) => n.start < s.to && n.end > s.from)
                  ? "Asleep"
                  : day.now != null && s.from >= day.now
                    ? "Nothing planned"
                    : "No screens"}
              </span>
            </div>
          ) : null,
        )}

        {/* Hour rules. The label steps aside when the now pill would cover it. */}
        {hours.map((h) => (
          <div
            key={`h${h}`}
            aria-hidden="true"
            className="absolute inset-x-0 border-t-[0.5px] border-separator"
            style={{ top: y(h) }}
          >
            {(nowY != null && Math.abs(y(h) - nowY) < 16) || edges.has(h) ? null : (
              <span className="absolute -top-[7px] left-0 bg-bg pr-1 text-caption font-medium text-label-2">
                {formatTime(iso(h))}
              </span>
            )}
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
          <button
            type="button"
            key={`cal${p.start}${p.title}`}
            onClick={() => setPicked({ kind: "plan", plan: p })}
            aria-label={`${p.title}, ${span(p.start, p.end)}`}
            className={`absolute right-(--lane-r) left-[50px] rounded-block border-[1.5px] border-dashed ${
              p.michael ? "border-tint" : "border-label-2"
            }`}
            style={{ top: y(p.start), height: Math.max(4, y(p.end) - y(p.start)) }}
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
          // A solid chip in the block's own colour: hatching or a cut never runs through the text.
          const chip = b.kind === "work" ? "bg-spark" : b.kind === "lost" ? "bg-bg" : "bg-fill";
          const ink = b.kind === "work" ? "text-[#000]" : "text-label";
          const { title, apps } = blockTitle(b, plans);
          const sub = b.kind === "lost" ? null : [apps, blockMeta(b)].filter(Boolean).join(" · ");
          return (
            <div key={`b${b.start}`}>
              <button
                type="button"
                onClick={() => setPicked({ kind: "block", block: b })}
                aria-label={`${title}, ${span(b.start, b.end)}`}
                data-live-key={`b${b.kind}${b.start}-${b.end}`}
                className={`absolute right-(--lane-r) left-[50px] overflow-hidden rounded-block text-left ${fill}`}
                style={{ top, height: h }}
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
                  <span
                    className={`absolute top-1 right-5 left-1 flex text-footnote leading-4 font-semibold ${ink}`}
                  >
                    <span className={`max-w-full truncate rounded-[4px] px-1 ${chip}`}>
                      {title}
                      {b.kind === "lost" ? ` ${hm(b.minutes)}` : null}
                    </span>
                  </span>
                ) : null}
                {h >= 36 && sub ? (
                  <span
                    className={`absolute top-[21px] right-5 left-1 flex text-[12px] leading-4 font-medium ${ink}`}
                  >
                    <span className={`max-w-full truncate rounded-[4px] px-1 opacity-80 ${chip}`}>{sub}</span>
                  </span>
                ) : null}
              </button>
              {b.plan && b.movedEnd ? (
                <>
                  <div
                    className="absolute right-(--lane-r) left-[50px] rounded-b-block border-[1.5px] border-dashed border-tint"
                    style={{ top: y(b.plan.end), height: Math.max(6, y(b.movedEnd) - y(b.plan.end)) }}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute left-[50px] rounded-[4px] bg-bg px-1 text-caption font-semibold text-tint-text"
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
              aria-hidden="true"
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
          const covered = [...day.blocks, ...workouts].some(
            (b) => y(b.start) < top + 18 && y(b.end) > top + 2,
          );
          return (
            <div key={`calt${p.start}${p.title}`} aria-hidden="true" className="pointer-events-none">
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
              aria-hidden="true"
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
            aria-hidden="true"
            className="pointer-events-none absolute right-[calc(var(--lane-r)+6px)] rounded-[4px] bg-bg px-1 text-caption font-semibold text-label"
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

        {day.now != null && nowY != null ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-0 left-[34px] border-t-[1.5px] border-label"
            style={{ top: nowY }}
          >
            <span className="absolute -top-[11px] -left-[34px] rounded-full bg-label px-1.5 py-[3px] text-caption font-bold text-bg">
              {formatTime(iso(day.now))}
            </span>
          </div>
        ) : null}
      </div>

      <Sheet
        open={picked != null}
        onClose={() => setPicked(null)}
        title={
          picked?.kind === "block"
            ? span(picked.block.start, picked.block.end)
            : picked?.kind === "plan"
              ? span(picked.plan.start, picked.plan.end)
              : ""
        }
      >
        {picked?.kind === "block" ? (
          <BlockDetail block={picked.block} plans={plans} sample={day.sample} />
        ) : null}
        {picked?.kind === "plan" ? <PlanDetail plan={picked.plan} now={day.now} /> : null}
      </Sheet>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b-[0.5px] border-separator py-2.5 last:border-b-0">
      <dt className="text-subhead text-label-2">{label}</dt>
      <dd className="text-right text-subhead font-semibold tnum">{children}</dd>
    </div>
  );
}

/** What, when, how long, which goal, what was lost. */
function BlockDetail({ block: b, plans, sample }: { block: Block; plans: Plan[]; sample?: boolean }) {
  const { title, apps } = blockTitle(b, plans);
  const plan = b.plan ?? planFor(b, plans);
  const lost = lostMinutesOf(b);
  const goal = plan
    ? plan.title
    : b.kind === "work"
      ? "Work, from time in work apps"
      : b.kind === "lost"
        ? "None, time lost"
        : "None";
  const interruptions = [
    ...b.cuts.map((c) => ({ at: c.at, what: c.what, minutes: c.minutes })),
    ...(b.lostStretches ?? []).map((l) => ({
      at: l.start,
      what: l.what,
      minutes: (l.end - l.start) / 60_000,
    })),
  ].sort((a, z) => a.at - z.at);
  const kind =
    b.kind === "work"
      ? sample
        ? "Goal time"
        : "Work apps"
      : b.kind === "lost"
        ? "Lost to messages and social"
        : "Other apps";

  return (
    <div className="tnum">
      <p className="text-footnote font-semibold text-label-2">{kind}</p>
      <h3 className="mt-0.5 text-title3 font-bold">{title}</h3>
      {apps ? <p className="mt-0.5 text-subhead text-label-2">{apps}</p> : null}
      <dl className="mt-3">
        <Row label="When">{span(b.start, b.end)}</Row>
        <Row label="How long">{minutesPhrase((b.end - b.start) / 60_000)}</Row>
        <Row label="Goal">{goal}</Row>
        <Row label="Lost">{lost >= 1 ? minutesPhrase(lost) : "Nothing"}</Row>
      </dl>
      {interruptions.length > 0 ? (
        <>
          <h4 className="mt-4 text-footnote font-semibold text-label-2">Interruptions</h4>
          <ul className="mt-1">
            {interruptions.map((i) => (
              <li
                key={i.at}
                className="flex justify-between gap-4 border-b-[0.5px] border-separator py-2 text-subhead last:border-b-0"
              >
                <span>
                  <span className="text-label-2">{formatTime(iso(i.at))}</span> {i.what}
                </span>
                <span className="font-semibold">{minutesPhrase(i.minutes)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function PlanDetail({ plan: p, now }: { plan: Plan; now?: number }) {
  return (
    <div className="tnum">
      <p className={`text-footnote font-semibold ${p.michael ? "text-tint-text" : "text-label-2"}`}>
        {p.michael ? "Booked by Michael" : "Planned"}
      </p>
      <h3 className="mt-0.5 text-title3 font-bold">{p.title}</h3>
      <dl className="mt-3">
        <Row label="When">{span(p.start, p.end)}</Row>
        <Row label="How long">{minutesPhrase((p.end - p.start) / 60_000)}</Row>
        <Row label="With others">{p.withOthers ? "Yes, I leave it alone" : "No"}</Row>
      </dl>
      {p.michael && (now == null || now < p.start) ? (
        <p className="mt-3 text-footnote text-label-2">I booked this. Undo it in Today until it starts.</p>
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

/**
 * The heart rate switch above the day, only on days with watch readings. The lanes need no key:
 * pink is goal time, hatched is lost, outlines are planned, and a tap on any block says the rest.
 */
export function HeartRow({ day, heartHidden = false }: { day: TimelineDay; heartHidden?: boolean }) {
  const heart = day.health?.heart ?? [];
  if (heart.length < 2) return null;
  const lo = Math.round(Math.min(...heart.map((p) => p.avg)));
  const hi = Math.round(Math.max(...heart.map((p) => p.avg)));
  return (
    <div className="mt-3 flex min-h-6 items-center justify-end text-caption font-medium text-label-2">
      <HeartToggle target={TIMELINE_ID} hidden={heartHidden} range={`${lo} to ${hi}`} />
    </div>
  );
}
