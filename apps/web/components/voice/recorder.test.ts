import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceProblems } from "@michael/shared";
import {
  chooseInput,
  levelOf,
  NOTHING_HEARD_COPY,
  PAUSE_MS,
  pickMimeType,
  silenceDetector,
  transcribeErrorCopy,
  uploadType,
} from "./recorder";

const base = { recognition: true, refused: false, recorder: true, server: "yes" as const, ios: false };

test("desktop Chrome keeps the browser's recogniser (live words)", () => {
  assert.equal(chooseInput(base), "recognition");
});

test("the iPhone home screen app records for the API once the recogniser refused", () => {
  assert.equal(chooseInput({ ...base, refused: true, ios: true }), "recorder");
  // Before the API has answered whether it can transcribe, the refusal still means no voice here.
  assert.equal(chooseInput({ ...base, refused: true, ios: true, server: "unknown" }), "none");
});

test("iOS prefers the API even with a recogniser, which cuts off early there", () => {
  assert.equal(chooseInput({ ...base, ios: true }), "recorder");
  // But never when the API cannot transcribe: Safari's recogniser is the fallback.
  assert.equal(chooseInput({ ...base, ios: true, server: "no" }), "recognition");
});

test("no recogniser (Firefox): record if the API can, else no voice", () => {
  assert.equal(chooseInput({ ...base, recognition: false }), "recorder");
  assert.equal(chooseInput({ ...base, recognition: false, server: "no" }), "none");
  assert.equal(chooseInput({ ...base, recognition: false, recorder: false }), "none");
});

test("the first format the browser records, Safari's mp4 included", () => {
  assert.equal(
    pickMimeType((t) => t.startsWith("audio/webm")),
    "audio/webm;codecs=opus",
  );
  assert.equal(
    pickMimeType((t) => t === "audio/mp4"),
    "audio/mp4",
  );
  assert.equal(
    pickMimeType(() => {
      throw new Error("old Safari");
    }),
    null,
  );
  assert.equal(
    pickMimeType(() => false),
    null,
  );
});

test("the upload type has no codecs and is always audio", () => {
  assert.equal(uploadType("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(uploadType("audio/mp4"), "audio/mp4");
  assert.equal(uploadType("video/webm"), "audio/webm");
  assert.equal(uploadType(""), "audio/webm");
});

test("the level is the loudness of the frame", () => {
  assert.equal(levelOf([]), 0);
  assert.equal(levelOf([0, 0, 0]), 0);
  assert.equal(levelOf([0.5, -0.5, 0.5, -0.5]), 0.5);
  assert.equal(levelOf([2, -2]), 1);
});

test("a pause after speaking ends the turn, once; noise alone never does", () => {
  const d = silenceDetector();
  const events: string[] = [];
  const feed = (level: number, at: number) => {
    const e = d.feed(level, at);
    if (e) events.push(`${e}@${at}`);
  };
  // Room noise for a second: nothing.
  for (let t = 0; t < 1000; t += 50) feed(0.01, t);
  // A click is not speech.
  feed(0.2, 1000);
  feed(0.01, 1050);
  for (let t = 1100; t < 3000; t += 50) feed(0.01, t);
  assert.deepEqual(events, []);
  // Speaking for a second, then quiet.
  for (let t = 3000; t <= 4000; t += 50) feed(0.1, t);
  for (let t = 4050; t <= 4000 + PAUSE_MS + 500; t += 50) feed(0.01, t);
  assert.deepEqual(events, ["speech@3150", `pause@${4000 + PAUSE_MS}`]);
});

test("a short breath between words does not end the turn", () => {
  const d = silenceDetector();
  let paused = false;
  for (let t = 0; t <= 500; t += 50) d.feed(0.1, t);
  for (let t = 550; t <= 1100; t += 50) if (d.feed(0.01, t) === "pause") paused = true;
  for (let t = 1150; t <= 1500; t += 50) d.feed(0.1, t);
  assert.equal(paused, false);
  assert.equal(d.spoke, true);
});

test("every line keeps Michael's voice and stays short", () => {
  const lines = [
    NOTHING_HEARD_COPY,
    ...["rate_limited", "bad_request", "network", "unavailable", "unauthorized", "upstream_error", "x"].map(
      transcribeErrorCopy,
    ),
  ];
  for (const line of lines) {
    assert.deepEqual(voiceProblems(line), [], line);
    assert.ok(line.split(" ").length < 15, line);
  }
});
