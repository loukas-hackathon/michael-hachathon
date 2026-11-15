import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiError, VOICE_AUDIO_MAX_BYTES, VoiceStatus, VoiceTranscript } from "@michael/shared";
import { app } from "../app";
import { runAsUser } from "../context";
import { DEMO_VISITOR_HEADER } from "../demo/visitor";
import { env } from "../env";
import { createPersonalToken } from "../tokens";
import { cleanTranscript, resetTranscribeRefusal } from "../transcribe";
import { audioTypeOf, transcribeLimit } from "./voice";

const realFetch = globalThis.fetch;
const realLog = console.error;
const AUDIO = new Uint8Array(4000).fill(7);

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realLog;
  env.ELEVENLABS_API_KEY = undefined;
  resetTranscribeRefusal();
  transcribeLimit.perMinute.reset();
  transcribeLimit.perDay.reset();
});

type Seen = { url: string; key: string | null; model: unknown; file: Blob | null };

/** Stands in for ElevenLabs Speech to Text; records what was sent to it. */
function mockScribe(answer: () => Response): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const form = init?.body as FormData;
    const file = form.get("file");
    seen.push({
      url: String(input),
      key: new Headers(init?.headers).get("xi-api-key"),
      model: form.get("model_id"),
      file: file instanceof Blob ? file : null,
    });
    return answer();
  }) as typeof fetch;
  return seen;
}

const scribe = (text: string, language_code = "en") =>
  new Response(JSON.stringify({ text, language_code, language_probability: 0.98, words: [] }), {
    headers: { "content-type": "application/json" },
  });

function post(body: BodyInit, type = "audio/webm;codecs=opus", headers: Record<string, string> = {}) {
  return app.request("/v1/voice/transcribe", {
    method: "POST",
    headers: { authorization: "Bearer dev-key", "content-type": type, ...headers },
    body,
  });
}

const codeOf = async (res: Response) => ApiError.parse(await res.json()).error.code;

test("audio goes to ElevenLabs Scribe and the text comes back", async () => {
  env.ELEVENLABS_API_KEY = "test-key";
  const seen = mockScribe(() => scribe("How much deep work have I done today?"));
  const res = await post(AUDIO);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(VoiceTranscript.parse(await res.json()), {
    text: "How much deep work have I done today?",
    language: "en",
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.url, "https://api.elevenlabs.io/v1/speech-to-text");
  assert.equal(seen[0]?.key, "test-key");
  assert.equal(seen[0]?.model, "scribe_v2");
  assert.equal(seen[0]?.file?.type, "audio/webm");
  assert.equal(seen[0]?.file?.size, AUDIO.byteLength);
});

test("Greek is detected, not forced to English", async () => {
  env.ELEVENLABS_API_KEY = "test-key";
  mockScribe(() => scribe("Πότε να πάω γυμναστήριο;", "el"));
  const res = await post(AUDIO, "audio/mp4");
  assert.deepEqual(await res.json(), { text: "Πότε να πάω γυμναστήριο;", language: "el" });
});

test("noise and silence markers are not words", () => {
  assert.equal(cleanTranscript("(silence)"), "");
  assert.equal(cleanTranscript("  (background noise) Gym at seven [music] "), "Gym at seven");
});

test("nothing is logged but ElevenLabs' status: no key, no audio, no words", async () => {
  env.ELEVENLABS_API_KEY = "secret-key-123";
  const logged: string[] = [];
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  mockScribe(() => new Response("server error", { status: 500 }));
  const res = await post(AUDIO);
  assert.equal(res.status, 502);
  assert.equal(await codeOf(res), "upstream_error");
  assert.ok(logged.length > 0);
  assert.ok(logged.every((l) => !l.includes("secret-key-123")));
});

test("a key without Speech to Text access turns voice input off for a while", async () => {
  env.ELEVENLABS_API_KEY = "test-key";
  const seen = mockScribe(() => new Response("missing_permissions", { status: 401 }));
  console.error = () => {};
  const first = await post(AUDIO);
  assert.equal(first.status, 503);
  const status = VoiceStatus.parse(
    await (await app.request("/v1/voice", { headers: { authorization: "Bearer dev-key" } })).json(),
  );
  assert.equal(status.transcribe, false);
  // The next recording is refused before it reaches ElevenLabs.
  assert.equal((await post(AUDIO)).status, 503);
  assert.equal(seen.length, 1);
});

test("without a key: 503, and the audio is not read", async () => {
  const seen = mockScribe(() => scribe("never"));
  const res = await post(AUDIO);
  assert.equal(res.status, 503);
  assert.equal(await codeOf(res), "unavailable");
  assert.equal(seen.length, 0);
});

test("only audio, between a tap and a minute", async () => {
  env.ELEVENLABS_API_KEY = "test-key";
  const seen = mockScribe(() => scribe("x"));
  assert.equal((await post(AUDIO, "application/json")).status, 400);
  assert.equal((await post(AUDIO, "text/plain")).status, 400);
  const tiny = await post(new Uint8Array(10));
  assert.equal(tiny.status, 400);
  const big = await post(new Uint8Array(VOICE_AUDIO_MAX_BYTES + 1));
  assert.equal(big.status, 400);
  assert.match(ApiError.parse(await big.json()).error.message, /under a minute/);
  assert.equal(seen.length, 0);
});

test("browsers' names for the same formats are understood", () => {
  assert.equal(audioTypeOf("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(audioTypeOf("audio/mp4"), "audio/mp4");
  assert.equal(audioTypeOf("audio/x-m4a"), "audio/mp4");
  assert.equal(audioTypeOf("audio/x-wav"), "audio/wav");
  assert.equal(audioTypeOf("image/png"), null);
  assert.equal(audioTypeOf(undefined), null);
});

test("rate limited per caller: twelve a minute, each demo visitor on their own", async () => {
  env.ELEVENLABS_API_KEY = "test-key";
  mockScribe(() => scribe("Gym at seven"));
  const alice = { [DEMO_VISITOR_HEADER]: "6f1c6c5e-1d8e-4a8e-9a43-0c4b1c1b0a01" };
  const bob = { [DEMO_VISITOR_HEADER]: "6f1c6c5e-1d8e-4a8e-9a43-0c4b1c1b0a02" };
  for (let i = 0; i < 12; i++) assert.equal((await post(AUDIO, "audio/webm", alice)).status, 200);
  const limited = await post(AUDIO, "audio/webm", alice);
  assert.equal(limited.status, 429);
  assert.equal(await codeOf(limited), "rate_limited");
  assert.equal((await post(AUDIO, "audio/webm", bob)).status, 200);
});

test("device keys cannot send audio", async () => {
  env.ELEVENLABS_API_KEY = "test-key";
  const seen = mockScribe(() => scribe("x"));
  const owner = "22222222-2222-4222-8222-222222222222";
  const { secret } = await runAsUser(owner, () => createPersonalToken("Mac"), "session");
  const res = await app.request("/v1/voice/transcribe", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "audio/webm" },
    body: AUDIO,
  });
  assert.equal(res.status, 403);
  assert.equal(seen.length, 0);
});

test("needs auth", async () => {
  const res = await app.request("/v1/voice/transcribe", {
    method: "POST",
    headers: { "content-type": "audio/webm" },
    body: AUDIO,
  });
  assert.equal(res.status, 401);
});
