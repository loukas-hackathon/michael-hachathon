import type { ChecklistItem, RitualKind } from "@michael/shared";
import { isValidCopy } from "../nudges/engine";
import type { DayRitual } from "../store";

// The Morning and Evening nudges (#169) open the daily ritual (#318): when its half is still to
// do, the nudge asks its question instead of the moment's headline. No new nudge, no new key: the
// cap, quiet hours and once a day stay the engine's. Pure.

export function ritualNudgeText(
  kind: RitualKind,
  input: { items: ChecklistItem[]; rows: DayRitual[] },
): string | null {
  if (input.rows.some((r) => r.kind === kind)) return null;
  const today = input.items.filter((i) => i.status !== "moved");
  let text: string;
  if (kind === "morning") {
    if (today.some((i) => !i.carried_from)) return null;
    text = "What do you want to get done today? Up to three.";
  } else {
    if (today.length === 0) return null;
    text =
      today.length === 1
        ? "One outcome today. What did you get done?"
        : `${today.length} outcomes today. What did you get done?`;
  }
  return isValidCopy(text) ? text : null;
}
