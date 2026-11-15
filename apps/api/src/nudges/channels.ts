import { type NudgeChannel, type NudgeStatus, nudgeUrl, type OutgoingNudge } from "@michael/shared";
import { currentUserId } from "../context";
import { env } from "../env";
import { type PushPayload, pushConfig, pushToCurrentUser } from "./push";
import { telegramChannel, telegramConfig } from "./telegram";
import { signActionToken } from "./token";

/**
 * Where a nudge goes. One implementation per channel: Apple Watch and iPhone push (#44),
 * Telegram (#43). A channel returns the status to store: `sent` once the device or service
 * accepted it, `failed` if it refused, `queued` if nothing real delivered it yet.
 * It runs inside the user's context (runAsUser), so it only reaches that user's devices.
 */
export interface DeliveryChannel {
  readonly name: NudgeChannel;
  /** The nudge with its buttons, when it has any (#399). */
  deliver(nudge: OutgoingNudge): Promise<NudgeStatus>;
}

/** Until a real channel is plugged in: log the nudge and leave it queued for the app to show. */
export const logChannel: DeliveryChannel = {
  name: "watch",
  async deliver(nudge) {
    console.log(`[nudge] ${nudge.kind} "${nudge.text}" (${nudge.reason})`);
    return "queued";
  },
};

/** The API's own address, for the worker's act request. */
const apiBase = () => env.PUBLIC_API_URL.replace(/\/$/, "");

/**
 * What the worker shows for a nudge: the line, a tap that opens the exact card, and its buttons
 * with a token signed for this nudge and the current user (#399).
 */
export function nudgePayload(n: OutgoingNudge, now = Date.now()): PushPayload {
  const payload: PushPayload = { title: "Michael", body: n.text, tag: n.kind, url: nudgeUrl(n) };
  if (!n.actions?.length) return payload;
  return {
    ...payload,
    actions: n.actions.map((a) => ({ action: a.id, title: a.label })),
    act_url: `${apiBase()}/v1/nudges/${n.id}/act`,
    token: signActionToken(n.id, currentUserId(), now),
  };
}

/** Web Push to every device of the user: the iPhone shows it and the Apple Watch buzzes. */
export const pushChannel: DeliveryChannel = {
  name: "push",
  async deliver(nudge) {
    const { devices, delivered } = await pushToCurrentUser(nudgePayload(nudge));
    console.log(`[nudge] ${nudge.kind} "${nudge.text}" pushed to ${delivered} of ${devices} devices`);
    if (devices === 0) return "queued";
    return delivered > 0 ? "sent" : "failed";
  },
};

/**
 * Every channel at once: a nudge reaches each place the user turned on (push devices, the
 * Telegram chat), so one failing service never loses it. `sent` when any channel took it,
 * `failed` when one tried and none took it, `queued` when none had anywhere to send. Named after
 * the first channel, which is what the stored nudge shows.
 */
export function allOf(channels: DeliveryChannel[]): DeliveryChannel {
  const [first] = channels;
  if (!first) return logChannel;
  if (channels.length === 1) return first;
  return {
    name: first.name,
    async deliver(nudge) {
      const results = await Promise.all(
        channels.map((c) =>
          c.deliver(nudge).catch((err): NudgeStatus => {
            console.error(`[nudge] ${c.name} delivery failed`, err);
            return "failed";
          }),
        ),
      );
      if (results.includes("sent")) return "sent";
      return results.includes("failed") ? "failed" : "queued";
    },
  };
}

// Push when VAPID keys are set, Telegram when the bot token is set (both when both), else the log.
export const primaryChannel = (): DeliveryChannel =>
  allOf([pushConfig() && pushChannel, telegramConfig() && telegramChannel].filter((c) => !!c));
