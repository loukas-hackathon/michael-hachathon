import {
  NUDGE_MUTE_MINUTES,
  NUDGE_SNOOZE_MINUTES,
  type Nudge,
  type NudgeAction,
  type NudgeActionId,
  type NudgeActResult,
  nudgeUrl,
} from "@michael/shared";
import { executeRecommendation, undoDeadline } from "../actions/calendar";
import { guardMacApps } from "../actions/mac-apps";
import { currentUserId, runAsUser } from "../context";
import { HttpError } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns/context";
import { MINUTE, Zone } from "../patterns/time";
import { store } from "../store";
import { primaryChannel } from "./channels";
import type { Candidate } from "./engine";
import { parseCallbackData, type TelegramUpdate, telegramApi } from "./telegram";

// Nudges you can act on (#399). A nudge offers at most two buttons (Chrome shows two), the action
// first. The service worker (push) and the Telegram webhook both land in `actOnNudge`, so the
// rules are one: the action must be one the nudge offered, it runs once, and it only ever does
// what Michael may do on its own (the user's own time and Mac, undoable).

const athens = new Zone(DEFAULT_TIMEZONE);

const OPEN: NudgeAction = { id: "open", label: "Open" };

/** The buttons for a nudge about to go out. */
export function actionsFor(c: Pick<Candidate, "kind" | "recommendation_id" | "mac_app">): NudgeAction[] {
  switch (c.kind) {
    case "block_soon":
      return [{ id: "snooze", label: `Snooze ${NUDGE_SNOOZE_MINUTES} min` }, OPEN];
    case "focus_drift":
      return c.mac_app
        ? [{ id: "mute_app", label: `Mute ${c.mac_app} ${NUDGE_MUTE_MINUTES} min`, app: c.mac_app }, OPEN]
        : [];
    case "recovery_block":
      return c.recommendation_id ? [{ id: "do_it", label: "Do it" }, OPEN] : [];
    default:
      return [];
  }
}

// ---------- snooze ----------

type Timer = (fn: () => void, ms: number) => void;
let timer: Timer = (fn, ms) => {
  // In memory: a deploy in those 10 minutes loses the snooze (the nudge is still on Today).
  setTimeout(fn, ms).unref?.();
};

/** Tests only: run snoozes at once (or capture them). */
export function configureSnooze(next: Timer) {
  timer = next;
}

/** A block_soon line says how long is left: say it again from the clock, not the old lead. */
export function refreshText(nudge: Pick<Nudge, "kind" | "text" | "day">, now = Date.now()): string {
  if (nudge.kind !== "block_soon") return nudge.text;
  const at = /at ([01]\d|2[0-3]):([0-5]\d)/.exec(nudge.text);
  if (!at) return nudge.text;
  const start = athens.at(nudge.day, Number(at[1]) * 60 + Number(at[2]));
  const lead = Math.round((start - now) / MINUTE);
  return nudge.text.replace(/Wrap up in \d+ min\./, lead >= 1 ? `Wrap up in ${lead} min.` : "It starts now.");
}

/** Sends the nudge again, buttons and all, as the user who snoozed it. */
export async function redeliver(nudgeId: string): Promise<void> {
  const nudge = await store.getNudge(nudgeId);
  if (!nudge) return;
  await store.releaseNudgeAction(nudge.id);
  const again: Nudge = { ...nudge, text: refreshText(nudge), acted_action: null, acted_at: null };
  await primaryChannel()
    .deliver(again)
    .catch((err) => console.error("[nudge] snooze delivery failed", err));
}

// ---------- the action ----------

const plainUntil = (iso: string) => athens.clock(Date.parse(iso));

/**
 * Carries out one button of one nudge for the current user. 404 unknown nudge, 409 when the nudge
 * does not offer it, was already acted on, or the action itself is refused (its reason).
 */
export async function actOnNudge(
  nudgeId: string,
  action: NudgeActionId,
  now = Date.now(),
): Promise<NudgeActResult> {
  const nudge = await store.getNudge(nudgeId);
  if (!nudge) throw new HttpError("not_found", "Nudge not found");
  const offered = nudge.actions.find((a) => a.id === action);
  if (!offered || action === "open") throw new HttpError("conflict", "That nudge does not offer this.");
  const claimed = await store.claimNudgeAction(nudge.id, action);
  if (!claimed) throw new HttpError("conflict", "Already done.");
  try {
    if (action === "snooze") {
      const userId = currentUserId();
      const back = now + NUDGE_SNOOZE_MINUTES * MINUTE;
      timer(() => {
        runAsUser(userId, () => redeliver(nudge.id)).catch((err) =>
          console.error("[nudge] snooze failed", err),
        );
      }, back - now);
      return {
        action,
        text: `Snoozed. Back at ${athens.clock(back)}.`,
        undo_until: null,
        url: nudgeUrl(nudge),
        nudge: claimed,
      };
    }
    if (action === "mute_app") {
      if (!offered.app) throw new HttpError("conflict", "No app to mute on this nudge.");
      const end = new Date(now + NUDGE_MUTE_MINUTES * MINUTE).toISOString();
      const rec = await guardMacApps({
        apps: [offered.app],
        start_at: new Date(now).toISOString(),
        end_at: end,
        goal_id: nudge.goal_id,
        requested_by: "a nudge",
      });
      return {
        action,
        text: `${offered.app} is off until ${plainUntil(end)}. Undo in the app.`,
        undo_until: end,
        url: `/?card=${rec.id}`,
        nudge: claimed,
      };
    }
    // do_it
    if (!nudge.recommendation_id) throw new HttpError("conflict", "Nothing to do on this nudge.");
    const rec = await executeRecommendation(nudge.recommendation_id);
    const until = (await undoDeadline(rec.id)) ?? rec.action?.undo_until ?? null;
    return {
      action,
      text: until ? `Done. Undo in the app until ${plainUntil(until)}.` : "Done. Undo in the app.",
      undo_until: until,
      url: `/?card=${rec.id}`,
      nudge: claimed,
    };
  } catch (err) {
    // Nothing happened: the button may be tried again (or done in the app).
    await store.releaseNudgeAction(nudge.id).catch(() => {});
    throw err;
  }
}

// ---------- Telegram buttons ----------

type CallbackQuery = NonNullable<TelegramUpdate["callback_query"]>;

/**
 * A tap on a nudge's button in Telegram. The chat says who it is (the chat a user bound with a
 * signed start link); the nudge must be theirs. Answers the tap (a short toast), takes the buttons
 * off the message once acted on, and sends the result as a new line so the watch buzzes with it.
 * Returns the toast text.
 */
export async function handleTelegramCallback(cb: CallbackQuery): Promise<string> {
  const parsed = parseCallbackData(cb.data);
  const chat = cb.message?.chat;
  if (!parsed || !chat || chat.type !== "private") return "I can't do that here.";
  const owner = await store.telegramChatOwner(String(chat.id));
  if (!owner) return "This chat is not connected.";
  let line: string;
  let done = false;
  try {
    const result = await runAsUser(owner, () => actOnNudge(parsed.nudgeId, parsed.action));
    line = result.text;
    done = true;
  } catch (err) {
    line = err instanceof HttpError ? err.message : "That did not work. Open Michael.";
    if (!(err instanceof HttpError)) console.error("[telegram] nudge action failed", err);
    // Already acted on elsewhere: the buttons are stale either way.
    done = err instanceof HttpError && err.message === "Already done.";
  }
  if (done && cb.message) {
    await telegramApi("editMessageReplyMarkup", {
      chat_id: chat.id,
      message_id: cb.message.message_id,
      reply_markup: { inline_keyboard: [] },
    });
  }
  await telegramApi("sendMessage", { chat_id: chat.id, text: line });
  return line;
}
