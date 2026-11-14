import { type Goal, GoalCreate, type GoalSuggestion, type GoalSuggestionAccept } from "@michael/shared";
import type { z } from "zod";
import { parse } from "../http";
import { store } from "../store";
import { suggestGoals, suggestionRange } from "./suggest";

// The store side of goal suggestions (#134): reads the current user's calendar and goals, then the
// pure clustering in suggest.ts decides. Used by the REST routes, the MCP tool and the calendar
// callback.

export async function currentSuggestions(now = new Date()) {
  const range = suggestionRange(now);
  const [events, goals] = await Promise.all([
    store.listEvents({ ...range, type: ["calendar_event"] }),
    store.listGoals(),
  ]);
  return { ...range, suggestions: suggestGoals(events, goals, { now }) };
}

type Edits = z.output<typeof GoalSuggestionAccept>;

/** A suggestion as a goal to create, with the user's edits on top. */
export function goalFromSuggestion(s: GoalSuggestion, edits: Edits = {}) {
  return parse(GoalCreate, {
    category: s.category,
    title: edits.title ?? s.title,
    description: `From your calendar: ${s.evidence}`,
    target: { ...s.target, ...(edits.calendar_titles ? { calendar_titles: edits.calendar_titles } : {}) },
    weekly_budget_minutes: edits.weekly_budget_minutes ?? s.weekly_budget_minutes,
  });
}

/** Creates the goal for suggestion `id`, or null when the calendar no longer suggests it. */
export async function acceptSuggestion(id: string, edits: Edits = {}): Promise<Goal | null> {
  const { suggestions } = await currentSuggestions();
  const s = suggestions.find((x) => x.id === id);
  return s ? store.createGoal(goalFromSuggestion(s, edits)) : null;
}
