import { type GoalArea, type PersonalRecord, voiceDuration } from "@michael/shared";
import { AREAS, areaName } from "./targets";

// Personal records (#166): recognition with real numbers, no points or badges. Pure: the score
// history and the records already stored go in, the new records come out.
//
// THE RECORD RULE (also in docs/api.md, "Records"; change both together)
//
//   Kinds       best_week (the week's score), best_week_area (one per category), longest_block
//               (the longest run of 5 minute ticks with no lost tick inside one goal block, in
//               minutes, across all goals).
//   Counts      Only a week that has ended, with at least 2 hours elapsed in that scope, sets a
//               week record; only a block that has ended (and its run at least 15 minutes) sets
//               a block record. A week with 30 minutes at 100% would otherwise stand forever.
//   First       The first value of a kind and scope is a baseline: the best of the history
//               available then, stored with `previous_value: null` and `line: null`, never
//               announced.
//   New best    Strictly greater than the stored best, on or after the day of that best. Equal
//               is not a record. Each period (a week, or a block on a day) sets a record once:
//               the store keeps a unique key per period, so a second read writes nothing.
//   The mark    A block record carries its event and the tick where the old best was passed.

export const RECORD_RULES = {
  minWeekElapsedMinutes: 120,
  minBlockMinutes: 15,
} as const;

/** One week of history as the record rule reads it. */
export interface RecordWeek {
  week_start: string;
  complete: boolean;
  score_pct: number | null;
  elapsed_minutes: number;
  areas: Record<GoalArea, { score_pct: number | null; elapsed_minutes: number }>;
}

/** The longest run with no lost tick inside one ended block (one day's part of it). */
export interface BlockRun {
  event_id: string;
  goal_id: string;
  goal_title: string;
  area: GoalArea;
  /** Local day of the block's part. */
  day: string;
  /** End of the block's part, ms. Orders the candidates. */
  end: number;
  minutes: number;
  /** Index of the run's first tick in the block's ticks. */
  first_tick: number;
  /** Minutes of each tick of the run, in order (5, except a shorter last tick). */
  tick_minutes: number[];
}

/** A record to store. `key` is unique per user: the same period never sets a record twice. */
export type NewRecord = Omit<PersonalRecord, "id" | "announced_at" | "created_at"> & { key: string };

interface Candidate {
  scope: string;
  key: string;
  at: number;
  value: number;
  record: Omit<NewRecord, "key" | "previous_value" | "line" | "tick_index">;
  run?: BlockRun;
}

/** Scope of a record: one best per kind, and per category for best_week_area. */
export const scopeOf = (r: Pick<PersonalRecord, "type" | "area">) =>
  r.type === "best_week_area" ? `${r.type}:${r.area}` : r.type;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Michael's line for a new best: under 15 words, the number first or close to it. */
export function recordLine(r: Pick<NewRecord, "type" | "area" | "value">, goalTitle?: string): string {
  if (r.type === "best_week") return `Best week since you started. ${r.value}%. Do it again.`;
  if (r.type === "best_week_area" && r.area) {
    return `Best ${areaName(r.area)} week since you started. ${r.value}%. Do it again.`;
  }
  const dur = voiceDuration(r.value);
  const named = goalTitle ? `${dur} on ${goalTitle} without a break. Your longest block yet.` : "";
  if (named && words(named) < 15) return named;
  return `${dur} without a break. Your longest block yet.`;
}

/** The tick where the run passed `previous` minutes. */
export function passedAt(run: BlockRun, previous: number): number {
  let total = 0;
  for (let i = 0; i < run.tick_minutes.length; i++) {
    total += run.tick_minutes[i] ?? 0;
    if (total > previous) return run.first_tick + i;
  }
  return run.first_tick + Math.max(0, run.tick_minutes.length - 1);
}

function candidates(weeks: RecordWeek[], runs: BlockRun[]): Candidate[] {
  const out: Candidate[] = [];
  const minWeek = RECORD_RULES.minWeekElapsedMinutes;
  for (const w of weeks) {
    if (!w.complete) continue;
    // The week's end orders it after every block inside it.
    const at = Date.parse(`${w.week_start}T00:00:00Z`) + 7 * 86_400_000;
    const base = { goal_id: null, event_id: null, achieved_on: w.week_start, unit: "pct" as const };
    if (w.score_pct !== null && w.elapsed_minutes >= minWeek) {
      out.push({
        scope: "best_week",
        key: `best_week:${w.week_start}`,
        at,
        value: w.score_pct,
        record: { ...base, type: "best_week", area: null, value: w.score_pct },
      });
    }
    for (const a of AREAS) {
      const row = w.areas[a];
      if (row.score_pct === null || row.elapsed_minutes < minWeek) continue;
      out.push({
        scope: `best_week_area:${a}`,
        key: `best_week_area:${a}:${w.week_start}`,
        at,
        value: row.score_pct,
        record: { ...base, type: "best_week_area", area: a, value: row.score_pct },
      });
    }
  }
  for (const run of runs) {
    if (run.minutes < RECORD_RULES.minBlockMinutes) continue;
    out.push({
      scope: "longest_block",
      key: `longest_block:${run.day}:${run.event_id}`,
      at: run.end,
      value: run.minutes,
      run,
      record: {
        type: "longest_block",
        area: run.area,
        goal_id: run.goal_id,
        value: run.minutes,
        unit: "minutes",
        achieved_on: run.day,
        event_id: run.event_id,
      },
    });
  }
  return out;
}

/**
 * The records the history sets that the store does not hold yet. Pass every stored record of
 * the user; the result is safe to insert with "ignore on duplicate key".
 */
export function detectRecords(input: {
  weeks: RecordWeek[];
  runs: BlockRun[];
  stored: PersonalRecord[];
}): NewRecord[] {
  const byScope = new Map<string, Candidate[]>();
  for (const c of candidates(input.weeks, input.runs)) {
    const list = byScope.get(c.scope) ?? [];
    list.push(c);
    byScope.set(c.scope, list);
  }
  const out: NewRecord[] = [];
  for (const [scope, list] of byScope) {
    list.sort((a, b) => a.at - b.at);
    const stored = input.stored.filter((r) => scopeOf(r) === scope);
    if (stored.length === 0) {
      // The first value is a baseline: the best so far, the earliest of equals. Never announced.
      const best = list.reduce((a, b) => (b.value > a.value ? b : a));
      out.push({ ...best.record, key: best.key, previous_value: null, line: null, tick_index: null });
      continue;
    }
    let best = Math.max(...stored.map((r) => r.value));
    const bestDay = stored
      .filter((r) => r.value === best)
      .map((r) => r.achieved_on)
      .sort()
      .at(-1) as string;
    for (const c of list) {
      if (c.record.achieved_on < bestDay || c.value <= best) continue;
      out.push({
        ...c.record,
        key: c.key,
        previous_value: best,
        line: recordLine(c.record, c.run?.goal_title),
        tick_index: c.run ? passedAt(c.run, best) : null,
      });
      best = c.value;
    }
  }
  return out;
}

/** What GET /v1/records lists: the current best of each kind and scope, plus any not yet announced. */
export function currentRecords(all: PersonalRecord[]): PersonalRecord[] {
  const best = new Map<string, PersonalRecord>();
  for (const r of all) {
    const held = best.get(scopeOf(r));
    if (!held || r.value > held.value) best.set(scopeOf(r), r);
  }
  const keep = new Set([...best.values()].map((r) => r.id));
  return all
    .filter((r) => keep.has(r.id) || (r.line !== null && r.announced_at === null))
    .sort((a, b) => (a.achieved_on < b.achieved_on ? -1 : a.achieved_on > b.achieved_on ? 1 : 0));
}
