import assert from "node:assert/strict";
import { test } from "node:test";
import {
  meansNoVoiceHere,
  type RecognitionEvent,
  recognitionErrorCopy,
  speakable,
  speechChunks,
  transcriptOf,
} from "./speech";

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
