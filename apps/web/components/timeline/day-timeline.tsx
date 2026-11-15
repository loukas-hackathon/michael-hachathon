"use client";

import { useRouter } from "next/navigation";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { addBlock, changeBlock, removeBlock, undoBlockChange } from "@/app/timeline/actions";
import { SettleBlock } from "@/components/log-time";
import { Sheet } from "@/components/sheet";
import { formatTime, hm, minutesPhrase, spokenDuration } from "@/lib/format";
import {
  type HeartPoint,
  type Nap,
  type Night,
  type SleepStages,
  sleepAgainstGoal,
  stageParts,
  workoutParts,
} from "@/lib/health";
import {
  type Block,
  blockTitle,
  lostMinutesOf,
  makeTime,
  makeY,
  openSegments,
  type Plan,
  planFor,
  type TimelineDay,
} from "@/lib/timeline";
import { BlockEditor, type GoalChip } from "./block-editor";
import { HeartToggle } from "./heart-toggle";

const PER_HOUR = 56;
const QUIET = 32;
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const span = (from: number, to: number) => `${formatTime(iso(from))} to ${formatTime(iso(to))}`;
const MIN = 60_000;
/** Moves and resizes snap to a quarter hour; a tap on a free slot to the half hour. */
const SNAP = 15 * MIN;
const snapTo = (ms: number, step = SNAP) => Math.round(ms / step) * step;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
/** How long a finger holds a block before it lifts (about what Calendar on the iPhone takes). */
const LONG_PRESS = 350;

/** A short tick under the finger, where the device has one (Android; iOS Safari has none). */
function buzz(ms: number) {
  try {
    if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(ms);
  } catch {
    // No haptics here; the drag still works.
  }
}

type Picked =
  | { kind: "block"; block: Block }
  | { kind: "plan"; plan: Plan }
  | { kind: "new"; plan: Plan }
  | { kind: "night"; night: Night; tonight: boolean }
  | { kind: "nap"; nap: Nap };

/** A block as the viewer sees it right now: the server's, or an edit still landing. */
type Shown = Plan & { removed?: boolean; pending?: boolean };

/** The one line about the last change, shown in place under the block it is about. */
type Status = { text: string; at: number; error?: boolean; undo?: () => void; key: number } | null;

type Gesture = {
  plan: Plan;
  mode: "move" | "resize";
  pointerId: number;
  x0: number;
  y0: number;
  boxTop: number;
  /** Where in the block the finger took hold, so the block does not jump to it. */
  grab: number;
  mouse: boolean;
  active: boolean;
  timer?: number;
  start: number;
  end: number;
};

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
 *
 * The watch's nights frame the day (the night rule, lib/health.ts): the night you woke up from
 * above it, the night you went to bed from below it, faint. Tap either for the stages.
 *
 * Editing (#271), on the user's own live days, like Calendar on the iPhone: tap a free slot to add a
 * block; tap a block to change its title, time or goal; long press and drag to move it, or drag its
 * bottom edge to change the end (a mouse drags at once). Quarter hour snap, a tick per step where
 * the device has haptics. Every change shows at once, rolls back if the server refuses, and says
 * what happened with an Undo in one line under the block. Blocks with other people stay read only.
 */
export function DayTimeline({
  day,
  heartHidden = false,
  sleepGoal = null,
  editable = false,
  goals = [],
}: {
  day: TimelineDay;
  /** The heart rate lane starts hidden (the viewer turned it off). */
  heartHidden?: boolean;
  /** Minutes a night the Sleep goal asks for; null without one. */
  sleepGoal?: number | null;
  /** The user's own day, today or ahead: free slots and solo blocks can be edited. */
  editable?: boolean;
  goals?: GoalChip[];
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const formId = useId();
  const health = day.health;
  const nights = [health?.lastNight, health?.tonight].filter((n): n is Night => Boolean(n));
  const workouts = health?.workouts ?? [];
  const naps = health?.naps ?? [];
  const lastNight = health?.lastNight ?? null;
  const tonight = health?.tonight ?? null;
  const heart = health?.heart ?? [];
  const [picked, setPicked] = useState<Picked | null>(null);
  const [over, setOver] = useState<Record<string, Shown>>({});
  const [drag, setDrag] = useState<{ id: string; start: number; end: number } | null>(null);
  // Stretches the viewer opened, kept as times so they stay open when a refresh redraws the rows.
  const [opened, setOpened] = useState<{ start: number; end: number }[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [removing, setRemoving] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef(false);
  const inFlight = useRef(new Set<string>());

  // A refresh brings the server's day: edits that have landed give way to it, ones in flight stay.
  const [seen, setSeen] = useState(day);
  if (seen !== day) {
    setSeen(day);
    setOver((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.pending)));
  }

  // The server's blocks with the viewer's edits on top, and the one under the finger where it is now.
  const plans = useMemo(() => {
    const out: Shown[] = [];
    const ids = new Set<string>();
    for (const p of day.plans ?? []) {
      const o = p.id ? over[p.id] : undefined;
      if (p.id) ids.add(p.id);
      if (!o) out.push(p);
      else if (!o.removed) out.push(o);
    }
    for (const [id, o] of Object.entries(over)) if (!ids.has(id) && !o.removed) out.push(o);
    return out
      .map((p) => (drag && p.id === drag.id ? { ...p, start: drag.start, end: drag.end } : p))
      .sort((a, b) => a.start - b.start);
  }, [day.plans, over, drag]);

  const draft = picked?.kind === "new" ? picked.plan : null;
  // Quiet rows open when tapped, or when an edit lands in them.
  const segments = useMemo(() => {
    const touched = [
      ...plans.filter((p) => p.id && (over[p.id] || p.id === drag?.id)),
      ...(draft ? [draft] : []),
    ];
    return openSegments(day.segments, (s) =>
      [...opened, ...touched].some((p) => p.start < s.to && p.end > s.from),
    );
  }, [day.segments, opened, plans, over, drag, draft]);

  const y = makeY(segments, PER_HOUR, QUIET);
  const timeAt = makeTime(segments, PER_HOUR, QUIET);
  const height = y(day.dayEnd);
  const nowY = day.now != null ? y(day.now) : null;
  // The collapsed rows print their own times, so the hour labels at their edges stay out.
  const edges = new Set(segments.flatMap((s) => (s.kind === "quiet" ? [s.from, s.to] : [])));
  const hours: number[] = [];
  for (const s of segments) {
    if (s.kind !== "hours") continue;
    for (let h = s.from; h <= s.to; h += HOUR) hours.push(h);
  }

  // While a block is held, the page must not scroll under it (only a non passive listener can say so).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const hold = (e: TouchEvent) => {
      if (gesture.current?.active && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", hold, { passive: false });
    return () => el.removeEventListener("touchmove", hold);
  }, []);

  // A success line steps aside after a while; an error stays until the next change.
  useEffect(() => {
    if (!status || status.error) return;
    const t = setTimeout(() => setStatus((s) => (s?.key === status.key ? null : s)), 8000);
    return () => clearTimeout(t);
  }, [status]);

  const say = (text: string, at: number, undo?: () => void) => setStatus({ text, at, undo, key: Date.now() });
  const fail = (text: string, at: number) => setStatus({ text, at, error: true, key: Date.now() });
  const refresh = () => startRefresh(() => router.refresh());
  const put = (id: string, v: Shown | null) =>
    setOver((o) => {
      const next = { ...o };
      if (v) next[id] = v;
      else delete next[id];
      return next;
    });

  /** Takes a change back: `to` is how the block looks once undone, `from` how it looks now. */
  const undo = async (recId: string, id: string, to: Shown, from: Shown) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    put(id, { ...to, pending: true });
    say("Undone.", to.removed ? from.end : to.end);
    try {
      const r = await undoBlockChange(recId);
      if (!r.ok) {
        put(id, { ...from, pending: false });
        fail(`I could not undo that. ${r.message ?? ""}`.trim(), from.end);
        return;
      }
      put(id, { ...to, pending: false });
      refresh();
    } catch {
      put(id, { ...from, pending: false });
      fail("I could not reach the server. Nothing changed.", from.end);
    } finally {
      inFlight.current.delete(id);
    }
  };

  /** Move, resize, rename or set the goal of one block: shown at once, rolled back on refusal. */
  const save = async (before: Plan, after: Plan) => {
    const id = before.id;
    if (!id || inFlight.current.has(id)) return;
    const body: { start_at?: string; end_at?: string; title?: string; goal_id?: string | null } = {};
    if (after.start !== before.start) body.start_at = iso(after.start);
    if (after.end !== before.end) body.end_at = iso(after.end);
    if (after.title !== before.title) body.title = after.title;
    if ((after.goalId ?? null) !== (before.goalId ?? null)) body.goal_id = after.goalId ?? null;
    if (Object.keys(body).length === 0) return;
    const moved = body.start_at !== undefined;
    const text = moved
      ? `Moved to ${formatTime(iso(after.start))}.`
      : body.end_at !== undefined
        ? `Now ends at ${formatTime(iso(after.end))}.`
        : "Saved.";
    inFlight.current.add(id);
    put(id, { ...after, pending: true });
    say(text, after.end);
    try {
      const r = await changeBlock(id, body);
      if (!r.ok) {
        put(id, { ...before, pending: false });
        fail(`I could not ${moved ? "move it" : "change it"}. ${r.message}`, before.end);
        return;
      }
      put(id, { ...after, pending: false });
      say(text, after.end, () => undo(r.recId, id, before, after));
      refresh();
    } catch {
      put(id, { ...before, pending: false });
      fail("I could not reach the server. Nothing changed.", before.end);
    } finally {
      inFlight.current.delete(id);
    }
  };

  const create = async (p: Plan) => {
    const temp = `new-${p.start}-${Date.now()}`;
    const shown: Shown = { ...p, id: temp, michael: true, removable: true, editable: false, pending: true };
    put(temp, shown);
    setPicked(null);
    const text = `Added at ${formatTime(iso(p.start))}.`;
    say(text, p.end);
    try {
      const r = await addBlock({
        start_at: iso(p.start),
        end_at: iso(p.end),
        title: p.title,
        goal_id: p.goalId ?? null,
      });
      if (!r.ok) {
        put(temp, null);
        fail(`I could not add it. ${r.message}`, p.end);
        return;
      }
      const id = r.id;
      const added: Shown = { ...shown, id: id ?? temp, editable: true, pending: false };
      setOver((o) => {
        const { [temp]: _, ...rest } = o;
        return id ? { ...rest, [id]: added } : rest;
      });
      say(text, p.end, id ? () => undo(r.recId, id, { ...added, removed: true }, added) : undefined);
      refresh();
    } catch {
      put(temp, null);
      fail("I could not reach the server. Nothing changed.", p.end);
    }
  };

  /** Deleting is not optimistic (michael-feedback): the button says so, then the line offers Undo. */
  const remove = async (p: Plan) => {
    const id = p.id;
    if (!id || removing) return;
    setRemoving(true);
    setSheetError(null);
    try {
      const r = await removeBlock(id);
      if (!r.ok) {
        setSheetError(`I could not delete it. ${r.message}`);
        return;
      }
      put(id, { ...p, removed: true, pending: false });
      setPicked(null);
      say("Deleted.", p.start, () => undo(r.recId, id, { ...p, removed: false }, { ...p, removed: true }));
      refresh();
    } catch {
      setSheetError("I could not reach the server. Nothing changed.");
    } finally {
      setRemoving(false);
    }
  };

  const open = (next: Picked) => {
    setSheetError(null);
    setPicked(next);
  };

  // ---------- gestures ----------

  const earliest = () => Math.max(day.dayStart, Math.ceil(Date.now() / SNAP) * SNAP);

  const onPlanDown = (e: ReactPointerEvent<HTMLButtonElement>, p: Plan) => {
    swallowClick.current = false;
    if (!editable || !p.editable || !p.id || !box.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const boxTop = box.current.getBoundingClientRect().top;
    const g: Gesture = {
      plan: p,
      mode: rect.bottom - e.clientY <= 14 && rect.height >= 24 ? "resize" : "move",
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      boxTop,
      grab: timeAt(e.clientY - boxTop) - p.start,
      mouse: e.pointerType === "mouse",
      active: false,
      start: p.start,
      end: p.end,
    };
    gesture.current = g;
    // Keep the pointer's moves even when it leaves the block (a mouse would lose them).
    e.currentTarget.setPointerCapture(e.pointerId);
    const id = p.id;
    if (!g.mouse) {
      // Touch: a long press lifts the block, so an ordinary swipe still scrolls the day.
      g.timer = window.setTimeout(() => {
        if (gesture.current !== g) return;
        g.active = true;
        buzz(10);
        setDrag({ id, start: g.start, end: g.end });
      }, LONG_PRESS);
    }
  };

  const onPlanMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId || !g.plan.id) return;
    if (!g.active) {
      const dist = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
      if (g.mouse && dist > 4) {
        g.active = true;
      } else if (!g.mouse && dist > 8) {
        // The finger moved before the long press: it is a scroll.
        clearTimeout(g.timer);
        gesture.current = null;
        return;
      } else return;
    }
    const at = timeAt(e.clientY - g.boxTop);
    const len = g.plan.end - g.plan.start;
    let start = g.plan.start;
    let end: number;
    if (g.mode === "move") {
      start = clamp(snapTo(at - g.grab), earliest(), day.dayEnd - len);
      end = start + len;
    } else {
      end = clamp(snapTo(at), start + SNAP, day.dayEnd);
    }
    if (start === g.start && end === g.end && drag) return;
    if (start !== g.start || end !== g.end) buzz(5);
    g.start = start;
    g.end = end;
    setDrag({ id: g.plan.id, start, end });
  };

  const onPlanUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    clearTimeout(g.timer);
    gesture.current = null;
    if (!g.active) return; // A plain tap: the click opens the sheet.
    swallowClick.current = true;
    setDrag(null);
    if (g.start !== g.plan.start || g.end !== g.plan.end) {
      void save(g.plan, { ...g.plan, start: g.start, end: g.end });
    }
  };

  const onPlanCancel = () => {
    const g = gesture.current;
    if (g) clearTimeout(g.timer);
    gesture.current = null;
    setDrag(null);
  };

  /** A tap or click on a free slot: a new block from that half hour, an hour long. */
  const onBoxClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!editable || e.target !== e.currentTarget) return;
    const at = timeAt(e.clientY - e.currentTarget.getBoundingClientRect().top);
    if (at < Date.now()) return say("That time has passed. Tap a time ahead.", at);
    const start = Math.max(Math.floor(at / (30 * MIN)) * 30 * MIN, earliest());
    const end = Math.min(start + HOUR, day.dayEnd);
    if (end - start < SNAP) return;
    open({
      kind: "new",
      plan: { start, end, title: "", michael: true, withOthers: false, goalId: null, editable: true },
    });
  };

  const pickedPlan = picked?.kind === "plan" ? picked.plan : null;
  const sheetPlan = picked?.kind === "new" ? picked.plan : pickedPlan;
  const canEditSheet = Boolean(
    editable && sheetPlan && (picked?.kind === "new" || (pickedPlan?.editable && pickedPlan.id)),
  );

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
      {lastNight ? (
        <SleepBand
          night={lastNight}
          goal={sleepGoal}
          onOpen={() => setPicked({ kind: "night", night: lastNight, tonight: false })}
        />
      ) : null}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: a tap on a free slot is a pointer shortcut; with a keyboard, each block's sheet sets its times */}
      <div
        ref={box}
        id={TIMELINE_ID}
        data-hr={heart.length > 1 && !heartHidden ? "on" : "off"}
        data-editable={editable ? "on" : undefined}
        onClick={onBoxClick}
        className="group/tl relative mt-3 tnum [--lane-r:16px] data-[hr=on]:[--lane-r:44px]"
        style={{ height }}
      >
        {/* Quiet stretches, collapsed. Ahead of now, a tap opens the hours to plan in them. */}
        {segments.map((s) => {
          if (s.kind !== "quiet") return null;
          const times = `${formatTime(iso(s.from))} to ${
            s.to - s.from >= 24 * HOUR - 60_000 ? "24:00" : formatTime(iso(s.to))
          }`;
          const label = nights.some((n) => n.start < s.to && n.end > s.from)
            ? "Asleep"
            : (day.now != null && s.from >= day.now) || (day.now == null && editable)
              ? "Nothing planned"
              : "No screens";
          const cls =
            "dots absolute inset-x-0 flex items-center justify-between rounded-block bg-fill px-2.5 text-footnote text-label-2";
          const style = { top: y(s.from) + 3, height: QUIET - 6 };
          const content = (
            <>
              <span>{times}</span>
              <span>{label}</span>
            </>
          );
          return editable && s.to > Math.max(day.now ?? 0, day.dayStart) ? (
            <button
              type="button"
              key={`q${s.from}`}
              aria-label={`${times}, ${label}. Open these hours to plan`}
              onClick={() => setOpened((o) => [...o, { start: s.from, end: s.to }])}
              className={`press text-left ${cls}`}
              style={style}
            >
              {content}
            </button>
          ) : (
            <div key={`q${s.from}`} aria-hidden="true" className={cls} style={style}>
              {content}
            </div>
          );
        })}

        {/* Hour rules. The label steps aside when the now pill would cover it. */}
        {hours.map((h) => (
          <div
            key={`h${h}`}
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 border-t-[0.5px] border-separator"
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
            className="pointer-events-none absolute left-[42px] w-[3px] rounded-full bg-label opacity-40"
            style={{ top: y(m.start), height: Math.max(3, y(m.end) - y(m.start)) }}
          />
        ))}

        {/* Planned outlines first, then what happened on top. Michael's own blocks are outlined in tint.
            The user's own blocks ahead can be held and dragged; the one held is filled and solid. */}
        {plans.map((p) => {
          const live = editable && p.editable && p.id;
          const held = drag != null && p.id === drag.id;
          const h = Math.max(4, y(p.end) - y(p.start));
          return (
            <button
              type="button"
              key={p.id ?? `cal${p.start}${p.title}`}
              data-block-id={p.id}
              onClick={() => {
                if (swallowClick.current) {
                  swallowClick.current = false;
                  return;
                }
                open({ kind: "plan", plan: p });
              }}
              onPointerDown={live ? (e) => onPlanDown(e, p) : undefined}
              onPointerMove={live ? onPlanMove : undefined}
              onPointerUp={live ? onPlanUp : undefined}
              onPointerCancel={live ? onPlanCancel : undefined}
              onContextMenu={live ? (e) => e.preventDefault() : undefined}
              aria-label={`${p.title}, ${span(p.start, p.end)}`}
              className={`group/plan absolute right-(--lane-r) left-[50px] rounded-block border-[1.5px] ${
                held ? "border-solid bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)]" : "border-dashed"
              } ${p.michael || held ? "border-tint" : "border-label-2"} ${
                live ? "cursor-grab touch-manipulation select-none [-webkit-touch-callout:none]" : ""
              } ${(p as Shown).pending ? "opacity-70" : ""}`}
              style={{ top: y(p.start), height: h }}
            >
              {live && h >= 24 ? (
                // The bottom edge: drag it to change the end.
                <span className="absolute inset-x-0 bottom-0 flex h-3.5 cursor-ns-resize items-end justify-center pb-[3px]">
                  <span
                    className={`h-[3px] w-6 rounded-full bg-label-2 transition-opacity duration-[var(--m-dur-ui)] ease-[var(--m-ease-out)] ${
                      held ? "opacity-60" : "opacity-0 group-hover/plan:opacity-40"
                    }`}
                  />
                </span>
              ) : null}
            </button>
          );
        })}
        {draft ? (
          <div
            className="pointer-events-none absolute right-(--lane-r) left-[50px] rounded-block border-[1.5px] border-tint bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)]"
            style={{ top: y(draft.start), height: Math.max(4, y(draft.end) - y(draft.start)) }}
          >
            <span className="absolute top-1 left-1 rounded-[4px] px-1 text-footnote leading-4 font-semibold text-tint-text">
              New block
            </span>
          </div>
        ) : null}
        {drag ? (
          <span
            className="pointer-events-none absolute left-[58px] z-10 rounded-[4px] bg-bg px-1 text-caption font-semibold text-tint-text"
            style={{ top: Math.max(0, y(drag.start) - 16) }}
          >
            {span(drag.start, drag.end)}
          </span>
        ) : null}
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

        {/* Done time the user logged (#317): goal time in their own word, so pink like a workout. Taps go
            through to the block it covers (its sheet has Did it and the details). */}
        {(day.logged ?? []).map((l) => {
          const top = y(l.start);
          const h = Math.max(3, y(l.end) - top);
          return (
            <div
              key={`log${l.start}`}
              data-live-key={`log${l.start}-${l.end}`}
              className="pointer-events-none absolute right-(--lane-r) left-[50px] overflow-hidden rounded-block bg-spark"
              style={{ top, height: h }}
              title={`${l.title}, logged, ${span(l.start, l.end)}`}
            >
              {h >= 17 ? (
                <p className="absolute top-1 right-2 left-2 truncate text-footnote leading-4 font-semibold text-[#000]">
                  {l.title}
                </p>
              ) : null}
              {h >= 36 ? (
                <p className="absolute top-[21px] right-2 left-2 truncate text-[12px] leading-4 font-medium text-[#000] opacity-80">
                  Logged · {hm((l.end - l.start) / 60_000)}
                </p>
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
              className="pointer-events-none absolute right-(--lane-r) left-[50px] overflow-hidden rounded-block bg-spark"
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

        {/* Naps from the watch: small and quiet, with the sleep dots. Never the night. */}
        {naps.map((n) => {
          const top = y(n.start);
          const h = Math.max(18, y(Math.min(n.end, day.dayEnd)) - top);
          return (
            <button
              type="button"
              key={`n${n.start}`}
              onClick={() => setPicked({ kind: "nap", nap: n })}
              aria-label={`Nap, ${minutesPhrase(n.minutes)}, ${span(n.start, n.end)}`}
              className="dots absolute right-(--lane-r) left-[50px] overflow-hidden rounded-block bg-fill text-left"
              style={{ top, height: h }}
            >
              <span className="absolute top-1/2 right-5 left-1 flex -translate-y-1/2 text-[12px] leading-4 font-medium text-label-2">
                <span className="max-w-full truncate rounded-[4px] bg-fill px-1">Nap · {hm(n.minutes)}</span>
              </span>
            </button>
          );
        })}

        {/* Plan titles where nothing happened over their first lines, and Michael's marker always. */}
        {plans.map((p) => {
          const top = y(p.start);
          const h = y(p.end) - top;
          const covered = [...day.blocks, ...workouts, ...naps].some(
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
            className="pointer-events-none absolute right-0.5 w-2 rounded-[1px] bg-label-2"
            style={{ top: y(m.start), height: Math.max(2, y(m.end) - y(m.start)) }}
          />
        ))}

        {/* What just changed, in place under the block it is about, with Undo (michael-feedback). */}
        {status && !drag ? (
          <div
            key={status.key}
            role={status.error ? "alert" : "status"}
            className="m-swap absolute right-(--lane-r) left-[50px] z-10 flex"
            style={{ top: Math.min(y(clamp(status.at, day.dayStart, day.dayEnd)) + 4, height - 28) }}
          >
            <p className="flex max-w-full min-w-0 items-center gap-2 rounded-[4px] bg-bg pl-1 text-footnote font-semibold tnum">
              <span className={`min-w-0 truncate ${status.error ? "text-danger" : "text-label"}`}>
                {status.text}
              </span>
              {status.undo ? (
                <button
                  type="button"
                  onClick={status.undo}
                  className="press -my-2 min-h-9 shrink-0 px-2 font-semibold text-tint-text"
                >
                  Undo
                </button>
              ) : null}
            </p>
          </div>
        ) : null}

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

      {tonight ? (
        <SleepBand
          night={tonight}
          goal={sleepGoal}
          tonight
          isToday={day.now != null}
          onOpen={() => setPicked({ kind: "night", night: tonight, tonight: true })}
        />
      ) : null}

      <Sheet
        open={picked != null}
        onClose={() => setPicked(null)}
        title={picked ? sheetTitle(picked) : ""}
        closeLabel={canEditSheet ? "Cancel" : "Done"}
        trailing={
          canEditSheet ? (
            <button
              type="submit"
              form={formId}
              className="press -mr-2 h-11 min-w-[4.5rem] px-2 text-right text-body font-semibold text-tint-text"
            >
              {picked?.kind === "new" ? "Add" : "Save"}
            </button>
          ) : undefined
        }
      >
        {picked?.kind === "block" ? (
          <BlockDetail block={picked.block} plans={plans} sample={day.sample} />
        ) : null}
        {canEditSheet && sheetPlan ? (
          <>
            <BlockEditor
              key={`${picked?.kind}${sheetPlan.id ?? sheetPlan.start}`}
              formId={formId}
              plan={sheetPlan}
              isNew={picked?.kind === "new"}
              goals={goals}
              dayStart={day.dayStart}
              removing={removing}
              onSave={(next) => {
                if (picked?.kind === "new") void create(next);
                else if (pickedPlan) {
                  setPicked(null);
                  void save(pickedPlan, next);
                }
              }}
              onRemove={
                picked?.kind === "plan" && pickedPlan?.removable ? () => void remove(pickedPlan) : undefined
              }
            />
            {sheetError ? (
              <p role="alert" className="mt-3 px-1 text-subhead text-danger">
                {sheetError}
              </p>
            ) : null}
          </>
        ) : pickedPlan ? (
          <PlanDetail plan={pickedPlan} now={day.now} goals={goals} />
        ) : null}
        {picked?.kind === "night" ? (
          <NightDetail night={picked.night} goal={sleepGoal} tonight={picked.tonight} />
        ) : null}
        {picked?.kind === "nap" ? <NapDetail nap={picked.nap} /> : null}
      </Sheet>
    </>
  );
}

function sheetTitle(p: Picked) {
  if (p.kind === "new") return "New block";
  const { start, end } =
    p.kind === "block" ? p.block : p.kind === "plan" ? p.plan : p.kind === "night" ? p.night : p.nap;
  return span(start, end);
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

/** A block that cannot be edited here: with other people, started, or the sample day. Read only. */
function PlanDetail({ plan: p, now, goals }: { plan: Plan; now?: number; goals: GoalChip[] }) {
  const goalTitle = p.goal ? null : p.goalId ? goals.find((g) => g.id === p.goalId)?.title : undefined;
  return (
    <div className="tnum">
      <p className={`text-footnote font-semibold ${p.michael ? "text-tint-text" : "text-label-2"}`}>
        {p.michael ? "Booked by Michael" : "Planned"}
      </p>
      <h3 className="mt-0.5 text-title3 font-bold">{p.title}</h3>
      <dl className="mt-3">
        <Row label="When">{span(p.start, p.end)}</Row>
        <Row label="How long">{minutesPhrase((p.end - p.start) / 60_000)}</Row>
        {goalTitle ? <Row label="Goal">{goalTitle}</Row> : null}
        <Row label="With others">{p.withOthers ? "Read only" : "No"}</Row>
      </dl>
      {p.withOthers && p.htmlLink ? (
        <a
          href={p.htmlLink}
          target="_blank"
          rel="noreferrer"
          className="press mt-4 inline-flex min-h-9 items-center rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text"
        >
          Open in Google Calendar
        </a>
      ) : null}
      {p.withOthers ? (
        <p className="mt-3 text-footnote text-label-2">Other people are in this one. I leave it alone.</p>
      ) : p.michael && (now == null || now < p.start) ? (
        <p className="mt-3 text-footnote text-label-2">I booked this. Undo it in Today until it starts.</p>
      ) : null}
      {p.goal ? (
        <dl className="mt-1">
          <Row label="Goal">{p.goal.title}</Row>
          {p.goal.settled ? (
            <Row label="You said">{p.goal.settled === "did" ? "Did it" : "Didn't"}</Row>
          ) : null}
        </dl>
      ) : null}
      {/* Did it / Didn't (#317): a started goal block no data proves yet. */}
      {p.id &&
      p.goal &&
      !p.goal.settled &&
      p.goal.unverified >= 1 &&
      !p.withOthers &&
      (now ?? Date.now()) > p.start ? (
        <div className="mt-4">
          <SettleBlock eventId={p.id} minutes={Math.round((p.end - p.start) / 60_000)} />
        </div>
      ) : null}
    </div>
  );
}

/** The day's container: the heart rate toggle in the key flips its data-hr. */
export const TIMELINE_ID = "day-timeline";

/**
 * A night from the watch, collapsed to one calm row with the dot texture: when, how long, and the
 * Sleep goal's verdict. The night you woke up from sits above the day; the night you went to bed
 * from sits below it, faint, because it belongs to the next day. Tap for the stages.
 */
function SleepBand({
  night,
  goal,
  tonight = false,
  isToday = false,
  onOpen,
}: {
  night: Night;
  goal: number | null;
  tonight?: boolean;
  isToday?: boolean;
  onOpen: () => void;
}) {
  const verdict = sleepAgainstGoal(night.minutes, goal);
  const name = tonight ? (isToday ? "Tonight" : "Then sleep") : "Sleep";
  return (
    <button
      type="button"
      onClick={onOpen}
      data-sleep-band={tonight ? "tonight" : "last-night"}
      className={`press dots flex min-h-9 w-full items-center justify-between gap-3 rounded-block bg-fill px-2.5 py-1.5 text-left text-footnote text-label-2 tnum ${
        tonight ? "mt-2 opacity-60" : "mt-3"
      }`}
    >
      <span className="min-w-0">
        <span className="font-semibold text-label">{name}</span> {formatTime(iso(night.start))} to{" "}
        {formatTime(iso(night.end))}
        <span className="sr-only">
          , {tonight ? "the night after this day" : "last night"}. Show the stages
        </span>
      </span>
      <span className="shrink-0 text-right">
        <b className="font-semibold text-label">{hm(night.minutes)}</b>
        {verdict ? `, ${verdict.replace(/ (of )?your goal$/, "")}` : ""}
      </span>
    </button>
  );
}

// Stage fills, deepest darkest and all grey: pink is goal time only. Awake is the bare sleep dots.
const STAGE_FILL: Record<keyof SleepStages, string> = {
  deep: "bg-label",
  core: "bg-label-2",
  rem: "bg-context",
  awake: "dots bg-fill shadow-[inset_0_0_0_1px_var(--m-separator)]",
};

/**
 * The night's stages as one continuous bar (awake, REM, core, deep) on the same scale as the Sleep
 * goal. The dashed line sits at awake time plus the goal, so it measures only the asleep stages:
 * the gap between the bar's end and the line is exactly the time short of the goal.
 */
function StageBar({ stages, goal }: { stages: SleepStages; goal: number | null }) {
  const parts = stageParts(stages);
  const awake = parts.find((p) => p.key === "awake")?.minutes ?? 0;
  const total = parts.reduce((n, p) => n + p.minutes, 0);
  const asleep = total - awake;
  const line = goal ? awake + goal : 0;
  const scale = Math.max(total, line) || 1;
  const pct = (m: number) => `${(m / scale) * 100}%`;
  return (
    <div className="mt-4">
      <div
        role="img"
        aria-label={parts.map((p) => `${p.name} ${minutesPhrase(p.minutes)}`).join(", ")}
        className="relative h-6"
      >
        <div className="absolute inset-y-0 left-0 flex gap-px" style={{ width: pct(total) }}>
          {parts.map((p) => (
            <span
              key={p.key}
              className={`h-full min-w-[3px] first:rounded-l-block last:rounded-r-block ${STAGE_FILL[p.key]}`}
              style={{ flexGrow: p.minutes, flexBasis: 0 }}
            />
          ))}
        </div>
        {goal ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 -bottom-1 border-l-[1.5px] border-dashed border-label"
            style={{ left: `calc(${pct(line)} - 1.5px)` }}
          />
        ) : null}
      </div>
      {goal ? (
        <p className="mt-2 text-caption font-medium text-label-2">
          {hm(asleep)} asleep against a goal of {hm(goal)}, the dashed line. Awake time stays out.
        </p>
      ) : null}
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2 text-subhead">
            <span
              aria-hidden="true"
              className={`inline-block size-3 shrink-0 rounded-[3px] ${STAGE_FILL[p.key]}`}
            />
            <span className="text-label-2">{p.name}</span>
            <span className="ml-auto font-semibold">{hm(p.minutes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One night: the stages, bedtime and wake, the Sleep goal, and the heart around it. */
function NightDetail({ night: n, goal, tonight }: { night: Night; goal: number | null; tonight: boolean }) {
  const verdict = sleepAgainstGoal(n.minutes, goal);
  return (
    <div className="tnum">
      <p className="text-footnote font-semibold text-label-2">
        {tonight ? "The night after this day" : "Last night"}, from the watch
      </p>
      <h3 className="mt-0.5 text-title3 font-bold">
        {hm(n.minutes)} asleep{verdict ? `, ${verdict}` : ""}
      </h3>
      {n.stages ? <StageBar stages={n.stages} goal={goal} /> : null}
      <dl className="mt-3">
        <Row label="Bedtime">{formatTime(iso(n.start))}</Row>
        <Row label="Woke">{formatTime(iso(n.end))}</Row>
        <Row label="Sleep goal">{goal ? hm(goal) : "None set"}</Row>
        {n.restingHr !== undefined ? <Row label="Resting heart rate">{n.restingHr} bpm</Row> : null}
        {n.hrv !== undefined ? <Row label="HRV">{n.hrv} ms</Row> : null}
      </dl>
    </div>
  );
}

function NapDetail({ nap }: { nap: Nap }) {
  return (
    <div className="tnum">
      <p className="text-footnote font-semibold text-label-2">Nap, from the watch</p>
      <h3 className="mt-0.5 text-title3 font-bold">{minutesPhrase(nap.minutes)}</h3>
      <dl className="mt-3">
        <Row label="When">{span(nap.start, nap.end)}</Row>
        <Row label="Sleep goal">Naps stay out of it</Row>
      </dl>
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
