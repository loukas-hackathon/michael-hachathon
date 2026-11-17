import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beatLevel,
  envelopeOf,
  isEcho,
  levelAt,
  meansNoVoiceHere,
  type RecognitionEvent,
  recognitionErrorCopy,
  replyCeilingMs,
  speakable,
  speechChunks,
  transcriptOf,
} from "./speech";

test("isEcho tells Michael's own voice from the user cutting in", () => {
  const saying = "Forty seven minutes of deep work so far. Want a block at 15:00?";
  assert.equal(isEcho("forty seven minutes of deep work", saying), true);
  assert.equal(isEcho("", saying), true);
  assert.equal(isEcho("wait, what about the gym tomorrow", saying), false);
  assert.equal(isEcho("forty seven minutes wait what about the gym", saying), false);
});

test("speakable drops the chat's markdown so no voice reads asterisks or dashes", () => {
  const reply = "You have done **1h 20m** of deep work.\n\n- 09:30 to 10:50 on the pitch\n1. Gym at 18:00";
  assert.equal(
    speakable(reply),
    "You have done 1h 20m of deep work. 09:30 to 10:50 on the pitch. Gym at 18:00.",
  );
  assert.equal(speakable("Keep the 2 * 25 minute blocks"), "Keep the 2 25 minute blocks.");
  assert.equal(speakable("  \n\n "), "");
});

test("speechChunks keeps sentences whole and short enough for Chrome", () => {
  assert.deepEqual(speechChunks("One. Two? Three!"), ["One. Two? Three!"]);
  assert.deepEqual(speechChunks("You slept 7.5 hours. Good."), ["You slept 7.5 hours. Good."]);
  const long = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
  const pieces = speechChunks(long, 60);
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every((p) => p.length <= 60));
  assert.equal(pieces.join(" "), long);
  assert.deepEqual(speechChunks(""), []);
});

test("an iPhone home screen app refusing recognition means no voice there, not a closed mic", () => {
  assert.equal(meansNoVoiceHere("service-not-allowed", false), true);
  assert.equal(meansNoVoiceHere("not-allowed", true), true);
  assert.equal(meansNoVoiceHere("not-allowed", false), false);
  assert.equal(meansNoVoiceHere("no-speech", true), false);
});

test("recognition errors have Michael's lines, and an abort stays quiet", () => {
  assert.match(recognitionErrorCopy("not-allowed") ?? "", /microphone/);
  assert.equal(recognitionErrorCopy("aborted"), null);
  assert.ok(recognitionErrorCopy("something-new"));
});

test("transcriptOf joins final and interim words in order", () => {
  const r = (t: string, isFinal = false) => Object.assign([{ transcript: t }], { isFinal });
  const e = {
    resultIndex: 1,
    results: [r("How much", true), r(" deep  work")],
  } as unknown as RecognitionEvent;
  assert.equal(transcriptOf(e), "How much deep work");
});

test("transcriptOf does not repeat the phrase when Android sends it whole in every result", () => {
  const r = (t: string) => Object.assign([{ transcript: t }], { isFinal: true });
  const e = {
    resultIndex: 2,
    results: [r("how"), r("how much"), r("How much deep work")],
  } as unknown as RecognitionEvent;
  assert.equal(transcriptOf(e), "How much deep work");
});

test("envelopeOf gives one loudness per frame, loud speech near 1 and silence at 0", () => {
  const rate = 600;
  // Half a second of silence, then half a second of a loud tone (10 frames per second).
  const samples = new Float32Array(rate);
  for (let i = rate / 2; i < rate; i++) samples[i] = Math.sin(i) * 0.5;
  const env = envelopeOf(samples, rate, 10);
  assert.equal(env.length, 10);
  assert.equal(env[0], 0);
  assert.ok((env[9] ?? 0) > 0.9);
  assert.ok(Array.from(env).every((v) => v >= 0 && v <= 1));
  assert.deepEqual(Array.from(envelopeOf(new Float32Array(100), rate, 10)), [0, 0]);
});

test("levelAt reads the envelope between frames and is 0 outside it", () => {
  const env = [0, 1, 0.5];
  assert.equal(levelAt(env, 0, 10), 0);
  assert.equal(levelAt(env, 0.05, 10), 0.5);
  assert.equal(levelAt(env, 0.1, 10), 1);
  assert.equal(levelAt(env, 1, 10), 0);
  assert.equal(levelAt(env, Number.NaN, 10), 0);
});

test("beatLevel swells on a word and dies away, with a rhythm when no words are reported", () => {
  assert.ok(beatLevel(0, 500) > beatLevel(200, 500));
  assert.ok(beatLevel(800, 1000) < 0.02);
  const rhythm = [1000, 1100, 1200, 1300].map((t) => beatLevel(5000, t));
  assert.ok(rhythm.every((v) => v > 0 && v < 0.6));
  assert.ok(new Set(rhythm.map((v) => v.toFixed(3))).size > 1);
});

test("a reply can never hold the conversation for good: its ceiling grows with the line, up to 90 s", () => {
  assert.equal(replyCeilingMs(""), 6000);
  assert.equal(replyCeilingMs("Train at 18:00."), 6000 + 15 * 120);
  assert.ok(replyCeilingMs("x".repeat(400)) > 50_000);
  assert.equal(replyCeilingMs("x".repeat(5000)), 90_000);
});
