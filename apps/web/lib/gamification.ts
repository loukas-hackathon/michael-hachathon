import type { Category } from "./categories";

// Recognition, not prizes (Manolis, Sat 19:42; issue #168). Local shapes that mirror #165, #166 and
// #167 as written; lib/score-map.ts maps the real fields onto these once the server posts them.

export type Areas = Record<Category, number>;
/** Per area; null for an area with no time goals (it has no score or target). */
export type MaybeAreas = Record<Category, number | null>;

/** Next week's target with the maths (#165). */
export type WeeklyTarget = {
  /** proposed: waiting for the user (the Monday card). accepted or edited: in force. */
  status: "proposed" | "accepted" | "edited";
  /** Monday of the week, for PUT /v1/targets/:week_start. */
  weekStart?: string;
  /** Median score of the last four full weeks. */
  median: number;
  overall: number;
  areas: MaybeAreas;
  floors: Areas;
  setBy: "michael" | "user";
  reason: string | null;
};

/** Before two full weeks of scores there is no proposal yet. */
export type Baseline = { weeksDone: number; weeksNeeded: number; reason?: string | null };

/** The balanced week: each area against its floor (#165). */
export type Balance = { overall: number | null; target: number | null; areas: MaybeAreas; floors: Areas };

/** A personal best, marked on the tape where it happened (#166). */
export type RecordMark = { tick: number; line: string };

/** The smallest block that still counts, after a missed one (#167). */
export type Recovery = { slotStart: string; slotEnd: string; undoUntil: string };

export const AREA_ORDER: Category[] = ["business", "health", "personal"];

/**
 * On target only when the overall meets the target and every area meets its floor. When an area is
 * under its floor, the line names the two areas furthest apart (copy: Brand, #168). Other states
 * carry no sentence until Brand writes one.
 */
export function verdict(b: Balance): { onTarget: boolean; line: string | null } {
  const name = (a: Category) => a.charAt(0).toUpperCase() + a.slice(1);
  const scored = AREA_ORDER.filter((a) => b.areas[a] != null);
  const score = (a: Category) => b.areas[a] as number;
  const low = scored.some((a) => score(a) < b.floors[a]);
  if (low && scored.length >= 2) {
    const sorted = [...scored].sort((x, y) => score(y) - score(x));
    const hi = sorted[0] as Category;
    const lo = sorted.at(-1) as Category;
    return {
      onTarget: false,
      line: `${name(hi)} ${b.areas[hi]}%. ${name(lo)} ${b.areas[lo]}%. That's not a win.`,
    };
  }
  return { onTarget: b.overall != null && b.target != null && b.overall >= b.target, line: null };
}

/** "Usual week 62%. Next week's target 65%: Business 70%, Health 62%, Personal 55%." */
export function targetLine(t: WeeklyTarget) {
  const parts = (["business", "health", "personal"] as Category[])
    .filter((a) => t.areas[a] != null)
    .map((a) => `${a.charAt(0).toUpperCase() + a.slice(1)} ${t.areas[a]}%`);
  return `Usual week ${t.median}%. Next week's target ${t.overall}%: ${parts.join(", ")}.`;
}
