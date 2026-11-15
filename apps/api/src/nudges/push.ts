import { sendNotification } from "web-push";
import { env } from "../env";
import { store } from "../store";

// Web Push: the nudge reaches the iPhone (Michael on the Home Screen, iOS 16.4+), which mirrors it
// to the Apple Watch, and any desktop browser that turned nudges on.

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** What the service worker (apps/web/public/sw.js) shows. */
export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  /** Where tapping the body goes: the exact card (nudgeUrl). */
  url: string;
  /** Buttons (#399). `open` opens `url`; the others POST { action, token } to `act_url`. */
  actions?: { action: string; title: string }[];
  act_url?: string;
  /** Signed for this nudge and user (nudges/token.ts): the worker has no session. */
  token?: string;
}

type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushSender = (
  sub: Subscription,
  payload: string,
  options: { vapidDetails: VapidConfig; TTL: number; urgency: "high" },
) => Promise<{ statusCode: number }>;

let vapid: VapidConfig | null =
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
    ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }
    : null;
let sender: PushSender = (sub, payload, options) => sendNotification(sub, payload, options);

export const pushConfig = (): VapidConfig | null => vapid;

/** Tests only: swap the keys and the network call. */
export function configurePush(next: { vapid?: VapidConfig | null; sender?: PushSender }) {
  if (next.vapid !== undefined) vapid = next.vapid;
  if (next.sender) sender = next.sender;
}

// The push service says the device is gone (unsubscribed, app deleted): forget it.
const GONE = new Set([404, 410]);

/**
 * Sends to every device of the current user. Returns how many devices there were and how many
 * accepted. Devices the push service reports as gone are removed.
 */
export async function pushToCurrentUser(
  payload: PushPayload,
): Promise<{ devices: number; delivered: number }> {
  const config = vapid;
  if (!config) return { devices: 0, delivered: 0 };
  const devices = await store.listPushDevices();
  const body = JSON.stringify(payload);
  const results = await Promise.all(
    devices.map(async (d) => {
      try {
        await sender(d, body, {
          vapidDetails: config,
          // A nudge is about now: drop it if the phone is unreachable for 10 minutes.
          TTL: 600,
          urgency: "high",
        });
        return true;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status && GONE.has(status)) await store.removePushDevice(d.endpoint);
        else console.error("[push] send failed", status ?? err);
        return false;
      }
    }),
  );
  return { devices: devices.length, delivered: results.filter(Boolean).length };
}
