import assert from "node:assert/strict";
import { test } from "node:test";
import { env } from "../env";
import { COACH_INSTRUCTIONS } from "./coach";
import {
  AnthropicModelClient,
  FakeModelClient,
  ModelError,
  ModelNotConfiguredError,
  modelClient,
  useModelClient,
} from "./model";
import { ANSWER_JSON_SCHEMA } from "./output";

// The real client, with the network replaced by a function that records the request and answers
// it. This pins down exactly what is sent; whether the API accepts it needs a key to find out.

interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function client(respond: () => { status?: number; body: unknown }) {
  const sent: Sent[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    sent.push({
      url: request.url,
      headers: request.headers,
      body: (await request.json()) as Record<string, unknown>,
    });
    const { status = 200, body } = respond();
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return {
    model: new AnthropicModelClient("test-key-not-real", "claude-opus-5-5", { fetch: fakeFetch }),
    sent,
  };
}

const message = (over: Record<string, unknown>) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: {
    input_tokens: 5200,
    output_tokens: 410,
    cache_read_input_tokens: 2100,
    cache_creation_input_tokens: 0,
  },
  ...over,
});

const request = {
  system: COACH_INSTRUCTIONS,
  user: "The brief for this run.",
  schema: ANSWER_JSON_SCHEMA as unknown as Record<string, unknown>,
};

test("the request is the one the issue asks for", async () => {
  const { model, sent } = client(() => ({
    body: message({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: '{"summary":"ok","recommendations":[],"question":null}' },
      ],
    }),
  }));
  const reply = await model.complete(request);
  assert.equal(sent.length, 1, "one request per call");
  const { url, headers, body } = sent[0] as Sent;
  assert.match(url, /\/v1\/messages(\?beta=true)?$/);
  // The key that was passed in is the only credential on the request (the SDK picks the header).
  const credentials = [headers.get("x-api-key"), headers.get("authorization")].filter((v) => v !== null);
  assert.equal(credentials.length, 1);
  assert.match(credentials[0] ?? "", /^(Bearer )?test-key-not-real$/);
  assert.match(headers.get("anthropic-beta") ?? "", /server-side-fallback-2026-07-01/);

  assert.equal(body.model, "claude-opus-5-5");
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.output_config, {
    effort: "medium",
    format: { type: "json_schema", schema: ANSWER_JSON_SCHEMA },
  });
  assert.equal(body.fallbacks, "default");
  // The stable instructions are the cached prefix; the brief is the only message.
  assert.deepEqual(body.system, [
    { type: "text", text: COACH_INSTRUCTIONS, cache_control: { type: "ephemeral" } },
  ]);
  assert.deepEqual(body.messages, [{ role: "user", content: "The brief for this run." }]);
  assert.equal(body.max_tokens, 16000);
  // Nothing this model rejects, and no streaming for a short answer.
  for (const key of ["temperature", "top_p", "top_k", "tools", "tool_choice", "stream", "betas"]) {
    assert.ok(!(key in body), `${key} must not be sent`);
  }

  // The answer is read from the text blocks only; thinking blocks come first and are skipped.
  assert.deepEqual(reply, {
    text: '{"summary":"ok","recommendations":[],"question":null}',
    model: "claude-opus-5-5",
    usage: {
      input_tokens: 5200,
      output_tokens: 410,
      cache_read_input_tokens: 2100,
      cache_creation_input_tokens: 0,
    },
  });
});

test("the model that answered is reported, which a fallback can change", async () => {
  const { model } = client(() => ({
    body: message({
      model: "claude-opus-4-8",
      content: [
        { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } },
        { type: "text", text: "{}" },
      ],
    }),
  }));
  assert.equal((await model.complete(request)).model, "claude-opus-4-8");
});

test("a refusal is seen from the stop reason, before any content is read", async () => {
  const { model } = client(() => ({
    body: message({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: "declined" },
      // Partial output from before the classifier fired must not be taken for an answer.
      content: [{ type: "text", text: '{"summary":"half an ans' }],
    }),
  }));
  await assert.rejects(
    () => model.complete(request),
    (err: unknown) => err instanceof ModelError && err.kind === "refusal" && /cyber/.test(err.message),
  );
  const noCategory = client(() => ({ body: message({ stop_reason: "refusal", stop_details: null }) }));
  await assert.rejects(
    () => noCategory.model.complete(request),
    (err: unknown) => err instanceof ModelError && err.kind === "refusal",
  );
});

test("a cut off or empty answer is a failure, not an answer", async () => {
  const cut = client(() => ({
    body: message({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"summary":"We got' }] }),
  }));
  await assert.rejects(
    () => cut.model.complete(request),
    (err: unknown) => err instanceof ModelError && err.kind === "truncated",
  );
  const empty = client(() => ({
    body: message({ content: [{ type: "thinking", thinking: "", signature: "s" }] }),
  }));
  await assert.rejects(
    () => empty.model.complete(request),
    (err: unknown) => err instanceof ModelError && err.kind === "empty",
  );
});

test("API errors become a short reason that holds nothing from the request", async () => {
  const cases: [number, RegExp][] = [
    [401, /rejected the key/],
    [404, /does not know this model/],
    [400, /rejected the request/],
  ];
  for (const [status, reason] of cases) {
    const { model } = client(() => ({
      status,
      body: { type: "error", error: { type: "invalid_request_error", message: "bad request" } },
    }));
    await assert.rejects(
      () => model.complete(request),
      (err: unknown) =>
        err instanceof ModelError &&
        err.kind === "api" &&
        reason.test(err.message) &&
        !err.message.includes("The brief for this run"),
      String(status),
    );
  }
});

test("without a key there is no client, and the server still starts", () => {
  const key = env.ANTHROPIC_API_KEY;
  try {
    env.ANTHROPIC_API_KEY = undefined;
    useModelClient(null);
    assert.throws(() => modelClient(), ModelNotConfiguredError);
    env.ANTHROPIC_API_KEY = "";
    assert.throws(() => modelClient(), ModelNotConfiguredError);
    const fake = new FakeModelClient(["{}"]);
    useModelClient(fake);
    assert.equal(modelClient(), fake);
  } finally {
    useModelClient(null);
    env.ANTHROPIC_API_KEY = key;
  }
});
