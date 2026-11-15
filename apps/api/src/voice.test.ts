import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONFIRMATIONS,
  confirmation,
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
  // The warmth pass (#398): human, a little wry, never guilt, wins with their number.
  assert.match(MICHAEL_VOICE, /Never guilt/);
  assert.match(MICHAEL_VOICE, /one light line at most/);
  assert.match(MICHAEL_VOICE, /Never in bad news/);
  assert.ok(!MICHAEL_VOICE.includes("!"));
});

test("confirmations vary by day and user, and the same seed always says the same thing", () => {
  const values = { x: "40 min", what: "Gym", at: "18:00" };
  for (const kind of Object.keys(CONFIRMATIONS) as (keyof typeof CONFIRMATIONS)[]) {
    for (const line of CONFIRMATIONS[kind]) {
      const filled = line.replace("{x}", values.x).replace("{what}", values.what).replace("{at}", values.at);
      assert.deepEqual(voiceProblems(filled), [], filled);
    }
    // Stable for one seed.
    assert.equal(confirmation(kind, "2026-11-15:u1", values), confirmation(kind, "2026-11-15:u1", values));
    // Over a month, more than one phrasing shows up.
    const seen = new Set(
      Array.from({ length: 30 }, (_, d) =>
        confirmation(kind, `2026-11-${String(d + 1).padStart(2, "0")}:u1`, values),
      ),
    );
    assert.ok(seen.size > 1, kind);
  }
  // The facts are always in the line.
  for (let d = 1; d <= 30; d++) {
    const seed = `2026-11-${String(d).padStart(2, "0")}:u2`;
    assert.match(confirmation("logged", seed, values), /40 min/);
    assert.match(confirmation("moved", seed, values), /Gym.*18:00/);
    assert.match(confirmation("booked", seed, values), /Gym/);
    assert.match(confirmation("undone", seed), /^[A-Z].*\.$/);
  }
  // A line that opens with the value still starts with a capital.
  assert.match(confirmation("logged", "x", { x: "40 min" }), /^[A-Z0-9]/);
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
