import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MICHAEL_VOICE,
  MICHAEL_VOICE_EXAMPLES,
  voiceDuration,
  voiceProblems,
  voiceShortDuration,
} from "@michael/shared";

test("the voice sheet examples pass the voice check", () => {
  for (const line of MICHAEL_VOICE_EXAMPLES) assert.deepEqual(voiceProblems(line), [], line);
});

test("the voice check catches what Michael never says", () => {
  assert.deepEqual(voiceProblems("Great job! Let's unlock your potential."), [
    "exclamation mark",
    "banned word: unlock",
    "banned word: potential",
    "banned word: great job",
  ]);
  assert.deepEqual(voiceProblems("Hustle through your morning — it pays off 🚀"), [
    "dash",
    "emoji",
    "banned word: hustle",
  ]);
  // Allowed since the score is called the optimisation score (Manolis, 15 Nov).
  assert.deepEqual(voiceProblems("Your optimisation score is 78% this week."), []);
  assert.deepEqual(voiceProblems("You had 114 pickups today."), ["banned word: pickups"]);
  assert.deepEqual(voiceProblems("Protect your productivity this morning."), ["banned word: productivity"]);
  // Hyphens inside words are fine; only dashes as punctuation are not.
  assert.deepEqual(voiceProblems("Your 24 hour view and a 45-minute block."), []);
});

test("the rules in the prompt follow the rules they set", () => {
  assert.doesNotMatch(MICHAEL_VOICE, /[–—]/);
  assert.match(MICHAEL_VOICE, /tough sports coach/);
  assert.match(MICHAEL_VOICE, /founders and executives/);
  assert.match(MICHAEL_VOICE, /evening check in, ask at most five/);
});

test("durations follow the voice sheet", () => {
  assert.equal(voiceDuration(0), "0 minutes");
  assert.equal(voiceDuration(0.75), "45 seconds");
  assert.equal(voiceDuration(1), "1 minute");
  assert.equal(voiceDuration(47), "47 minutes");
  assert.equal(voiceDuration(119), "119 minutes");
  assert.equal(voiceDuration(135), "2h 15");
  assert.equal(voiceDuration(180), "3h");
  assert.equal(voiceShortDuration(47), "47 min");
  assert.equal(voiceShortDuration(80), "1h 20");
  assert.equal(voiceShortDuration(65), "1h 05");
  assert.equal(voiceShortDuration(360), "6h");
});
