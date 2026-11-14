import { type PushConfig, PushSubscriptionInput, PushUnsubscribe } from "@michael/shared";
import { Hono } from "hono";
import { jsonBody, parse } from "../http";
import { pushConfig } from "../nudges/push";
import { store } from "../store";

async function config(): Promise<PushConfig> {
  const vapid = pushConfig();
  return {
    enabled: vapid !== null,
    public_key: vapid?.publicKey ?? null,
    devices: (await store.listPushDevices()).length,
  };
}

// Devices that turned nudges on, always for the signed-in caller (never a user id from the body).
export const push = new Hono()
  .get("/push", async (c) => c.json(await config()))
  .post("/push/subscriptions", async (c) => {
    const sub = parse(PushSubscriptionInput, await jsonBody(c));
    const ua = c.req.header("user-agent")?.slice(0, 300) ?? null;
    await store.savePushDevice({ endpoint: sub.endpoint, keys: sub.keys }, ua);
    return c.json(await config(), 201);
  })
  .delete("/push/subscriptions", async (c) => {
    const { endpoint } = parse(PushUnsubscribe, await jsonBody(c));
    await store.removePushDevice(endpoint);
    return c.json(await config());
  });
