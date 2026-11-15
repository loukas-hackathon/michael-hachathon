// How Michael is working it out (event `step` on /v1/chat/stream): one plain line per chat tool,
// in his voice. Labels never carry other people's titles, raw ids or the model's own words; only
// the user's own app name and minutes are read from the input, and the user's own goal name when
// the call points at a goal by its id (looked up in their goals, never the model's words).

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
  focus_now: "Starting focus now",
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const minutesOf = (m: unknown): number | null =>
  typeof m === "number" && Number.isFinite(m) && m > 0 && m <= 1440 ? Math.round(m) : null;

/** Labels that name the goal, for tools whose input points at one of the user's goals. */
const WITH_GOAL: Record<string, (goal: string, args: Record<string, unknown>) => string> = {
  create_focus_block: (g) => `Booking time for ${g}`,
  block_mac_app: (g) => `Guarding ${g} time`,
  log_done: (g, a) => {
    const m = minutesOf(a.minutes);
    return m ? `Logging ${m} min to ${g}` : `Logging time to ${g}`;
  },
  update_goal: (g) => `Updating ${g}`,
  propose_goal_change: (g) => `Weighing a change to ${g}`,
  add_checklist_item: (g) => `Adding it to ${g}`,
  focus_now: (g) => `Starting focus on ${g}`,
};

/** The goal id a call points at, for the tools whose label can name it. */
export function goalIdOf(name: string, input: unknown): string | null {
  if (!WITH_GOAL[name]) return null;
  const args = obj(input);
  if (typeof args.goal_id === "string") return args.goal_id;
  if (name === "propose_goal_change" && Array.isArray(args.changes) && args.changes.length === 1) {
    const id = obj(args.changes[0]).goal_id;
    if (typeof id === "string") return id;
  }
  return null;
}

/** A goal name short and plain enough for a step line; anything else falls back. */
function plainGoal(title: string | undefined): string | null {
  const t = title?.trim().replace(/\s+/g, " ");
  return t && t.length <= 24 && /^[\p{L}\p{N} .,'&+]+$/u.test(t) ? t : null;
}

/**
 * A short, safe label for a tool call; unknown tools get a generic line. `goalTitle` is the user's
 * own name for the goal the call points at (goalIdOf), when the caller looked it up.
 */
export function stepLabel(name: string, input: unknown, goalTitle?: string): string {
  const args = obj(input);
  if (name === "block_mac_app" && Array.isArray(args.apps) && args.apps.length === 1) {
    const app = args.apps[0];
    // One plain app name the user named (WhatsApp, Slack) says more than the goal.
    if (typeof app === "string" && /^[\p{L}\p{N} .+&]{1,24}$/u.test(app.trim()))
      return `Blocking ${app.trim()}`;
  }
  const goal = plainGoal(goalTitle);
  const withGoal = WITH_GOAL[name];
  if (goal && withGoal) return withGoal(goal, args);
  const minutes = minutesOf(args.minutes);
  if (name === "log_done" && minutes) return `Logging ${minutes} min`;
  if (name === "log_day" && Array.isArray(args.results)) {
    const total = args.results.reduce<number>((sum, it) => sum + (minutesOf(obj(it).minutes) ?? 0), 0);
    if (total > 0) return `Logging ${total} min`;
  }
  return LABELS[name] ?? FALLBACK_STEP;
}
