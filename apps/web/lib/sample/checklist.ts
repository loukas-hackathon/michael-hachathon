import type { ChecklistDay } from "../checklist";

// SAMPLE DATA for the day's list (#238), generic words, until GET /v1/checklist is live.
const t = "2026-11-11T07:30:00+02:00";
export const CHECKLIST_GOAL = "10000000-0000-4000-8000-000000000011";

const item = (n: number, text: string, extra: Partial<ChecklistDay["items"][number]> = {}) => ({
  id: `60000000-0000-4000-8000-00000000000${n}`,
  goal_id: CHECKLIST_GOAL,
  date: "2026-11-11",
  text,
  position: n - 1,
  status: "open" as const,
  settled_at: null,
  settled_by: null,
  carried_from: null,
  created_at: t,
  updated_at: t,
  ...extra,
});

export const sampleChecklist: ChecklistDay = {
  date: "2026-11-11",
  items: [
    item(1, "Send the proposal", {
      status: "done",
      settled_at: "2026-11-11T11:10:00+02:00",
      settled_by: "user",
    }),
    item(2, "Call back two leads"),
  ],
  suggestions: [item(3, "Finish the pitch deck", { date: "2026-11-10" })],
};
