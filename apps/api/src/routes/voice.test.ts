import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@michael/shared";
import { app } from "../app";

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const noKey = { skip: !!process.env.ELEVENLABS_API_KEY };

test("GET /v1/voice says whether ElevenLabs is set up", noKey, async () => {
  const res = await app.request("/v1/voice", { headers: auth });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { elevenlabs: false });
});

test("POST /v1/voice/speak validates the body", async () => {
  const res = await app.request("/v1/voice/speak", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ text: "" }),
  });
  assert.equal(res.status, 400);
});

test("POST /v1/voice/speak without a key answers 503", noKey, async () => {
  const res = await app.request("/v1/voice/speak", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ text: "Gym at 19:00. Go." }),
  });
  assert.equal(res.status, 503);
  assert.equal(ApiError.parse(await res.json()).error.code, "unavailable");
});

test("POST /v1/voice/speak needs auth", async () => {
  const res = await app.request("/v1/voice/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Hello" }),
  });
  assert.equal(res.status, 401);
});
