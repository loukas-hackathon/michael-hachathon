// How Michael is working it out (event `step` on /v1/chat/stream): one plain line per chat tool,
// in his voice. Labels never carry other people's titles, raw ids or the model's own words; only
// the user's own app name and minutes are read from the input.

/** The opening step, sent the moment the stream opens. */
export const OPENING_STEP = { id: "open", label: "Reading your day" } as const;

export const FALLBACK_STEP = "Working it out";

const LABELS: Record<string, string> = {
  find_calendar_blocks: "Reading your calendar",
  create_focus_block: "Booking the block",
  move_calendar_block: "Moving your block",
  block_mac_app: "Blocking distracting apps",
  draft_follow_up: "Drafting a follow up",
  undo_action: "Undoing that",
  answer_check_in: "Noting your answer",
  set_day_outcomes: "Setting today's outcomes",
  log_day: "Logging your day",
  get_week_review: "Looking at your week",
  remember: "Remembering that",
  forget_memory: "Forgetting that",
  what_you_know: "Checking what I know",
  propose_goal_change: "Weighing a goal change",
  propose_plan_change: "Weighing a plan change",
  log_done: "Logging your time",
  confirm_block: "Settling your block",
  add_goal: "Adding the goal",
  update_goal: "Updating your goal",
  add_checklist_item: "Adding it to your list",
  update_checklist_item: "Updating your list",
  add_instruction: "Noting your rule",
  update_instruction: "Updating your rule",
  save_place: "Saving the place",
  update_profile: "Updating your profile",
  focus_now: "Starting your focus",
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** A short, safe label for a tool call; unknown tools get a generic line. */
export function stepLabel(name: string, input: unknown): string {
  const args = obj(input);
  if (name === "block_mac_app" && Array.isArray(args.apps) && args.apps.length === 1) {
    const app = args.apps[0];
    // One plain app name the user named (WhatsApp, Slack); anything odd falls back.
    if (typeof app === "string" && /^[\p{L}\p{N} .+&]{1,24}$/u.test(app.trim()))
      return `Blocking ${app.trim()}`;
  }
  if (name === "log_done" && typeof args.minutes === "number" && args.minutes > 0 && args.minutes <= 1440) {
    return `Logging ${Math.round(args.minutes)} min`;
  }
  if (name === "log_day" && Array.isArray(args.results)) {
    const minutes = args.results.reduce<number>((sum, it) => {
      const m = obj(it).minutes;
      return sum + (typeof m === "number" && Number.isFinite(m) && m > 0 ? m : 0);
    }, 0);
    if (minutes > 0) return `Logging ${Math.round(minutes)} min`;
  }
  return LABELS[name] ?? FALLBACK_STEP;
}
