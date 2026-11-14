import type { Nudge, NudgeChannel, NudgeStatus } from "@michael/shared";
import { type PushPayload, pushConfig, pushToCurrentUser } from "./push";

/**
 * Where a nudge goes. One implementation per channel: Apple Watch and iPhone push (#44),
 * Telegram (#43). A channel returns the status to store: `sent` once the device or service
 * accepted it, `failed` if it refused, `queued` if nothing real delivered it yet.
 * It runs inside the user's context (runAsUser), so it only reaches that user's devices.
 */
export interface DeliveryChannel {
  readonly name: NudgeChannel;
  deliver(nudge: Nudge): Promise<NudgeStatus>;
}

/** Until a real channel is plugged in: log the nudge and leave it queued for the app to show. */
export const logChannel: DeliveryChannel = {
  name: "watch",
  async deliver(nudge) {
    console.log(`[nudge] ${nudge.kind} "${nudge.text}" (${nudge.reason})`);
    return "queued";
  },
};

export const nudgePayload = (n: Pick<Nudge, "text" | "kind">): PushPayload => ({
  title: "Michael",
  body: n.text,
  tag: n.kind,
  url: "/",
});

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

// Push when VAPID keys are set, otherwise the log. Telegram (#43) can become a fallback here.
export const primaryChannel = (): DeliveryChannel => (pushConfig() ? pushChannel : logChannel);
