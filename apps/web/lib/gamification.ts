import type { Category } from "./categories";

// Recognition, not prizes (Manolis, Sat 19:42; issue #168). Local shapes that mirror #165, #166 and
// #167 as written; lib/score-map.ts maps the real fields onto these once the server posts them.

export type Areas = Record<Category, number>;

/** Next week's target with the maths (#165). */
export type WeeklyTarget = {
  /** proposed: waiting for the user (the Monday card). accepted or edited: in force. */
  status: "proposed" | "accepted" | "edited";
  /** Median score of the last four full weeks. */
  median: number;
  overall: number;
  areas: Areas;
  floors: Areas;
  setBy: "michael" | "user";
  reason: string | null;
};

/** Before two full weeks of scores there is no proposal yet. */
export type Baseline = { weeksDone: number; weeksNeeded: number };

/** The balanced week: each area against its floor (#165). */
export type Balance = { overall: number | null; target: number | null; areas: Areas; floors: Areas };

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
  const low = AREA_ORDER.some((a) => b.areas[a] < b.floors[a]);
  if (low) {
    const sorted = [...AREA_ORDER].sort((x, y) => b.areas[y] - b.areas[x]);
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
  return `Usual week ${t.median}%. Next week's target ${t.overall}%: Business ${t.areas.business}%, Health ${t.areas.health}%, Personal ${t.areas.personal}%.`;
}
