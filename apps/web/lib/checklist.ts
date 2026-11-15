// The day's checklist (#238): up to three items per checklist goal, ticked by the user (Michael
// never ticks). Mirrors the contract posted on #238; switch to @michael/shared when it lands.

export type ChecklistItem = {
  id: string;
  goal_id: string;
  date: string;
  text: string;
  position: number;
  status: "open" | "done" | "partly" | "dropped" | "moved";
  settled_at: string | null;
  settled_by: "user" | "check_in" | null;
  carried_from: string | null;
  // The daily ritual (#318): the goal it serves, the estimate and the minutes logged.
  linked_goal_id?: string | null;
  estimate_minutes?: number | null;
  logged_minutes?: number | null;
  created_at: string;
  updated_at: string;
};

export type ChecklistDay = { date: string; items: ChecklistItem[]; suggestions: ChecklistItem[] };

/** Score rows (#238): checklist goals count items, count goals count sessions. */
export type ChecklistProgress = { today: { set: number; done: number }; week: { set: number; done: number } };
export type CountProgress = { done: number; target: number; left: number; days_left: number };

/** "1 of 2, 3 days left" (copy from #238). */
export function countLine(c: CountProgress) {
  return `${c.done} of ${c.target}, ${c.days_left} ${c.days_left === 1 ? "day" : "days"} left`;
}
