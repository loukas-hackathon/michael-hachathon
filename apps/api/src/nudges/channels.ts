import type { Nudge, NudgeChannel, NudgeStatus } from "@michael/shared";

/**
 * Where a nudge goes. One implementation per channel: Apple Watch and iPhone push (#44),
 * Telegram (#43). A channel returns the status to store: `sent` once the device or service
 * accepted it, `failed` if it refused, `queued` if nothing real delivered it yet.
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

// Register real channels here. The first one is used; later ones can become fallbacks.
const channels: DeliveryChannel[] = [logChannel];

export const primaryChannel = (): DeliveryChannel => channels[0] ?? logChannel;
