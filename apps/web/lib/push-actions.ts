"use server";

import { type NudgeTestResult, type PushConfig, PushSubscriptionInput } from "@michael/shared";
import { getPushConfig, postPushSubscription, postTestNudge } from "./api";

// Server functions behind "Turn on nudges". The browser calls these; only the server talks to the
// API, with the signed-in user's token. The subscription comes from the browser, so it is parsed.

export async function readPushConfig(): Promise<PushConfig> {
  return getPushConfig();
}

export async function savePushSubscription(sub: unknown): Promise<PushConfig> {
  return postPushSubscription(PushSubscriptionInput.parse(sub));
}

export async function sendTestNudge(): Promise<NudgeTestResult> {
  return postTestNudge();
}
