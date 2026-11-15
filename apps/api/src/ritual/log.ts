// The seam to the done time log (#317, POST /v1/log). The evening of the daily ritual (#318) hands
// every "I did 40 minutes of it" here. Until the log lands, the minutes are kept on the outcome
// itself (`checklist_items.logged_minutes`, written by the ritual) and named in the evening line,
// and `counted` is false: the goal's score does not count them yet. When #317 merges, call its
// store write from here (one place) and return `counted: true`.

export interface DoneTime {
  goal_id: string;
  minutes: number;
  /** The local day it was done. */
  day: string;
  /** The outcome in the user's words. */
  note: string;
}

export async function logDoneTime(_entry: DoneTime): Promise<{ counted: boolean }> {
  return { counted: false };
}
