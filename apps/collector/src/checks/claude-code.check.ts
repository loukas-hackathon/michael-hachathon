import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AI_PROMPT_NO_TEXT, type EventInput, scrubSecrets } from "@michael/shared";
import { createClaudeCodeReader } from "../readers/claude-code";

// A check for the Claude Code reader that needs no real transcripts: it writes made up session
// files, reads them, and asserts the rules. Run: pnpm --filter @michael/collector check:claude-code
// Every prompt, title, path and key below is invented.

const root = mkdtempSync(join(tmpdir(), "michael-claude-code-check-"));
const projectDir = join(root, "-work-demo-app");
const now = Date.now();
const day = new Date(now - 2 * 86_400_000).toISOString().slice(0, 10);
const at = (time: string) => `${day}T${time}.000Z`;
// Made up keys are assembled from two halves so that no secret scanner mistakes this file for a leak.
const fake = (head: string, tail: string) => head + tail;

const record = (time: string, extra: object) => ({
  parentUuid: null,
  isSidechain: false,
  sessionId: "s1",
  cwd: "/work/demo-app",
  timestamp: at(time),
  uuid: `u-${time}`,
  ...extra,
});
const human = (time: string, promptId: string, content: unknown) =>
  record(time, {
    type: "user",
    promptId,
    origin: { kind: "human" },
    promptSource: "sdk",
    message: { role: "user", content },
  });
const usage = (input: number, cacheWrite: number, cacheRead: number, output: number) => ({
  input_tokens: input,
  cache_creation_input_tokens: cacheWrite,
  cache_read_input_tokens: cacheRead,
  output_tokens: output,
});
const answer = (time: string, id: string, tokens: object) =>
  record(time, {
    type: "assistant",
    message: {
      id,
      role: "assistant",
      model: "claude-test-1",
      content: [{ type: "text", text: "PRIVATE assistant text" }],
      usage: tokens,
    },
  });

const write = (file: string, lines: unknown[]) =>
  writeFileSync(file, `${lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n")}\n`);

try {
  mkdirSync(join(projectDir, "s1", "subagents", "workflows", "w1"), { recursive: true });

  // Session s1, two days ago: two work stretches with a 44 minute pause between them.
  write(join(projectDir, "s1.jsonl"), [
    { type: "ai-title", aiTitle: "Made up session title", sessionId: "s1" },
    human("10:00:00", "P1", [
      {
        type: "text",
        text: `Fix the login bug, the key is ${fake("sk-", "ant-abcdefghijklmnop1234")} thanks`,
      },
    ]),
    // One answer written as two records with the same message id: its tokens count once.
    answer("10:00:05", "m1", usage(10, 100, 1000, 50)),
    answer("10:00:06", "m1", usage(10, 100, 1000, 50)),
    record("10:00:10", {
      type: "user",
      promptId: "P1",
      toolUseResult: { stdout: "PRIVATE tool output" },
      message: { role: "user", content: [{ type: "tool_result", content: "PRIVATE tool output" }] },
    }),
    answer("10:00:20", "m2", usage(5, 0, 2000, 20)),
    "this line is not JSON",
    { type: "a-record-type-from-the-future", payload: { type: "user" } },
    // Five minutes after the assistant finished: 300 seconds of waiting.
    human("10:05:20", "P2", "second prompt\nwith   a line break"),
    answer("10:05:30", "m3", usage(1, 0, 0, 1)),
    record("10:05:31", {
      type: "user",
      promptId: "P2",
      origin: { kind: "task-notification" },
      promptSource: "system",
      message: { role: "user", content: "<task-notification>PRIVATE report</task-notification>" },
    }),
    answer("10:05:40", "m4", usage(1, 0, 0, 1)),
    record("10:06:00", {
      type: "user",
      isMeta: true,
      message: { role: "user", content: "PRIVATE reminder" },
    }),
    // Second stretch.
    human("10:50:00", "P3", [
      { type: "text", text: "<ide_opened_file>PRIVATE path /x/y.ts</ide_opened_file>" },
      { type: "text", text: "third prompt" },
    ]),
    answer("10:50:10", "m5", usage(2, 0, 0, 3)),
    record("11:10:10", {
      type: "user",
      message: { role: "user", content: "<command-name>/clear</command-name>" },
    }),
    record("11:10:11", {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] },
    }),
    human("11:10:30", "P4", [
      { type: "text", text: '<pasted_content id="1">\nPRIVATE pasted text\n</pasted_content id="1">' },
    ]),
    // A two megabyte image inside the line must not stop the prompt from being read.
    human("11:10:40", "P5", [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD".repeat(600_000) } },
      { type: "text", text: "look at this picture" },
    ]),
    record("11:10:41", {
      type: "user",
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      message: { role: "user", content: "PRIVATE summary" },
    }),
    { type: "custom-title", customTitle: "Renamed by hand", sessionId: "s1" },
  ]);
  // A subagent of s1: its tokens join the first stretch, its prompt is not a human prompt.
  write(join(projectDir, "s1", "subagents", "workflows", "w1", "agent-a1.jsonl"), [
    {
      ...record("10:00:07", {
        type: "user",
        message: { role: "user", content: "PRIVATE task for the agent" },
      }),
      isSidechain: true,
    },
    { ...answer("10:00:08", "sm1", usage(1, 0, 10, 7)), isSidechain: true },
  ]);
  // Session s2 was active five minutes ago: its stretch is still open.
  const recent = (msAgo: number) => new Date(now - msAgo).toISOString();
  write(join(projectDir, "s2.jsonl"), [
    {
      type: "user",
      sessionId: "s2",
      cwd: "/work/other-app",
      timestamp: recent(300_000),
      uuid: "x1",
      promptId: "Q1",
      message: { role: "user", content: "a prompt in a session that is still going" },
    },
    {
      type: "assistant",
      sessionId: "s2",
      cwd: "/work/other-app",
      timestamp: recent(290_000),
      uuid: "x2",
      message: { id: "n1", model: "claude-test-1", usage: usage(1, 1, 1, 1) },
    },
  ]);

  const reader = createClaudeCodeReader({ root, now: () => now });
  const ctx = { backfillDays: 30, tmpDir: root, log: () => {} };
  const first = await reader.read({ ...ctx, cursor: null });
  const sessions = first.events.filter((e) => e.type === "ai_session");
  const prompts = first.events.filter((e) => e.type === "ai_prompt");
  const byId = (id: string) => first.events.find((e) => e.external_id === id) as EventInput;

  // Stretches: two closed ones from s1, none yet from the open s2.
  assert.deepEqual(
    sessions.map((e) => e.external_id),
    [`cc:s1:${at("10:00:00")}`, `cc:s1:${at("10:50:00")}`],
  );
  const one = sessions[0] as EventInput;
  assert.equal(one.end_at, at("10:06:00"));
  assert.equal(one.title, "Renamed by hand");
  assert.deepEqual(one.data, {
    tool: "claude_code",
    session_id: "s1",
    project: "demo-app",
    model: "claude-test-1",
    turns: 2,
    waiting_seconds: 300,
    // m1 once (1110) + m2 (2005) + m3 (1) + m4 (1) + the subagent (11).
    input_tokens: 3128,
    cached_input_tokens: 3010,
    output_tokens: 79,
  });
  const two = sessions[1] as EventInput;
  assert.equal(two.end_at, at("11:10:41"));
  // Three prompts; none of them follows a finished assistant turn, so no waiting is counted.
  assert.deepEqual(
    [two.data?.turns, two.data?.waiting_seconds, two.data?.input_tokens, two.data?.output_tokens],
    [3, 0, 2, 3],
  );

  // Prompts: only what a person typed, on one line, secrets masked.
  assert.deepEqual(
    prompts.map((e) => e.external_id),
    ["P1", "P2", "P3", "P4", "P5"].map((p) => `cc:s1:prompt:${p}`).concat("cc:s2:prompt:Q1"),
  );
  assert.equal(byId("cc:s1:prompt:P1").title, "Fix the login bug, the key is [secret] thanks");
  assert.equal(byId("cc:s1:prompt:P2").title, "second prompt with a line break");
  assert.equal(byId("cc:s1:prompt:P3").title, "third prompt");
  assert.equal(byId("cc:s1:prompt:P4").title, AI_PROMPT_NO_TEXT);
  assert.equal(byId("cc:s1:prompt:P5").title, "look at this picture");
  assert.deepEqual(byId("cc:s2:prompt:Q1").data, {
    tool: "claude_code",
    session_id: "s2",
    project: "other-app",
  });

  // Nothing from tool output, assistant text, pasted text, editor context or system records.
  assert.ok(!JSON.stringify(first.events).includes("PRIVATE"), "private text leaked into an event");

  // The open session holds the cursor back, so a second run reads it again.
  const second = await reader.read({ ...ctx, cursor: first.cursor });
  assert.ok(second.events.some((e) => e.external_id === "cc:s2:prompt:Q1"));
  assert.ok(!second.events.some((e) => e.type === "ai_session" && e.data?.session_id === "s2"));
  // Forty minutes on, the same stretch is closed and goes out with its final numbers.
  const later = createClaudeCodeReader({ root, now: () => now + 40 * 60_000 });
  const third = await later.read({ ...ctx, cursor: second.cursor });
  const closed = third.events.find((e) => e.type === "ai_session" && e.data?.session_id === "s2");
  assert.deepEqual([closed?.data?.turns, closed?.data?.input_tokens], [1, 3]);
  // With nothing open, the cursor moves past every file and the next run reads nothing.
  const fourth = await later.read({ ...ctx, cursor: third.cursor });
  assert.equal(fourth.events.length, 0);

  // The scrub on its own. All of these are made up.
  for (const secret of [
    fake("sk-", "proj-Abcdefgh12345678"),
    fake("ghp", "_abcdefghijklmnopqrstuvwxyz0123456789"),
    fake("AKIA", "ABCDEFGHIJKLMNOP"),
    fake("eyJ", "hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456"),
    fake("0123456789abcdef", "0123456789abcdef"),
    fake("QWxhZGRpbjpvcGVuIHNlc2FtZQ", "1234567890abcdefGHIJKL+/=="),
  ]) {
    const scrubbed = scrubSecrets(`use ${secret} here`);
    assert.ok(!scrubbed.includes(secret), `${secret} should be masked`);
  }
  assert.equal(scrubSecrets(`password: ${fake("hunter", "2abc")}`), "password: [secret]");
  assert.equal(scrubSecrets("Authorization: Bearer abc.def-ghi_123"), "Authorization: Bearer [secret]");
  assert.equal(
    scrubSecrets("postgres://admin:s3cretpw@db.example.com/app"),
    "postgres://admin:[secret]@db.example.com/app",
  );
  const plain = "Move the gym block to 18:30 and keep /work/demo-app/src/index.ts as it is";
  assert.equal(scrubSecrets(plain), plain);

  console.log(`Claude Code reader check passed: ${sessions.length} stretches, ${prompts.length} prompts.`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
