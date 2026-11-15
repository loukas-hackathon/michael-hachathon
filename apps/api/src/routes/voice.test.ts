import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiError, VoiceStatus } from "@michael/shared";
import { app } from "../app";
import { env } from "../env";
import { resetVoiceFallback } from "./voice";

const auth = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const realFetch = globalThis.fetch;
const LIBRARY_VOICE = "zs057lc0shdaAFXkm2Fm";
const GEORGE = "JBFqnCBsd6RMkjVDRZzb";

afterEach(() => {
  globalThis.fetch = realFetch;
  env.ELEVENLABS_API_KEY = undefined;
  env.ELEVENLABS_VOICE_ID = GEORGE;
  resetVoiceFallback();
});

/** Stands in for ElevenLabs: answers by voice id, and records which voices were asked for. */
function mockElevenLabs(answer: (voiceId: string) => number): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const voiceId = decodeURIComponent(url.split("/text-to-speech/")[1]?.split("?")[0] ?? "");
    asked.push(voiceId);
    const status = answer(voiceId);
    if (status !== 200) {
      return new Response(JSON.stringify({ detail: { status: "paid_plan_required" } }), { status });
    }
    return new Response(new Uint8Array([0xff, 0xfb, 0x90]), { headers: { "content-type": "audio/mpeg" } });
  }) as typeof fetch;
  return asked;
}

const speak = () =>
  app.request("/v1/voice/speak", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ text: "Gym at 19:00." }),
  });
const status = async () =>
  VoiceStatus.parse(await (await app.request("/v1/voice", { headers: auth })).json());

test("GET /v1/voice says whether ElevenLabs is set up", async () => {
  assert.deepEqual(await status(), {
    elevenlabs: false,
    voice: "device",
    reason: "no ElevenLabs key",
    transcribe: false,
  });
});

test("POST /v1/voice/speak validates the body", async () => {
  const res = await app.request("/v1/voice/speak", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ text: "" }),
  });
  assert.equal(res.status, 400);
});

test("POST /v1/voice/speak without a key answers 503", async () => {
  const res = await speak();
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

test("a library voice refused with 402 falls back to George, and that holds for an hour", async () => {
  env.ELEVENLABS_API_KEY = "test-key";
  env.ELEVENLABS_VOICE_ID = LIBRARY_VOICE;
  const asked = mockElevenLabs((id) => (id === LIBRARY_VOICE ? 402 : 200));
  assert.deepEqual(await status(), { elevenlabs: true, voice: "chosen", reason: null, transcribe: true });

  const first = await speak();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual(asked, [LIBRARY_VOICE, GEORGE]);
  assert.deepEqual(await status(), {
    elevenlabs: true,
    voice: "fallback",
    reason: "paid plan required",
    transcribe: true,
  });

  // The decision is cached: the next line goes straight to George.
  assert.equal((await speak()).status, 200);
  assert.deepEqual(asked, [LIBRARY_VOICE, GEORGE, GEORGE]);
});

test("a 401 falls back too; both refused is a 502 so the app speaks with the device voice", async () => {
  env.ELEVENLABS_API_KEY = "test-key";
  env.ELEVENLABS_VOICE_ID = LIBRARY_VOICE;
  const asked = mockElevenLabs(() => 401);
  const res = await speak();
  assert.equal(res.status, 502);
  assert.equal(ApiError.parse(await res.json()).error.code, "upstream_error");
  assert.deepEqual(asked, [LIBRARY_VOICE, GEORGE]);
});

test("other failures do not switch voices", async () => {
  env.ELEVENLABS_API_KEY = "test-key";
  env.ELEVENLABS_VOICE_ID = LIBRARY_VOICE;
  const asked = mockElevenLabs(() => 429);
  assert.equal((await speak()).status, 502);
  assert.deepEqual(asked, [LIBRARY_VOICE]);
  assert.equal((await status()).voice, "chosen");
});
