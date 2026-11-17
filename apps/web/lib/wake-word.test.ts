import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isFatalWakeError,
  isQuietWakeError,
  MAX_FAILURES,
  matchWake,
  parseNote,
  parseSetting,
  restartDelay,
  wakeIn,
} from "./wake-word";

test("his name alone wakes him, whatever the case and punctuation", () => {
  const said = [
    "Michael",
    "michael",
    "MICHAEL.",
    " Michael? ",
    "Hey Michael",
    "hey, Michael!",
    "Yo Michael",
    "OK Michael",
    "okay michael",
  ];
  for (const s of said) assert.deepEqual(matchWake(s), { first: null }, s);
});

test("a request in the same phrase becomes the first thing the user said", () => {
  assert.deepEqual(matchWake("Michael, how is my day going"), { first: "How is my day going" });
  assert.deepEqual(matchWake("hey michael when should I train tomorrow"), {
    first: "When should I train tomorrow",
  });
  assert.deepEqual(matchWake("Yo Michael: block an hour for the gym."), {
    first: "Block an hour for the gym.",
  });
});

test("common spellings of the name count", () => {
  for (const name of ["Micheal", "Michel", "Mikael", "Mikhail", "Michal"]) {
    assert.deepEqual(matchWake(`${name} what's next`), { first: "What's next" }, name);
  }
});

test("only the start of a phrase, and only the name itself", () => {
  assert.equal(matchWake("I told Michael about it"), null);
  assert.equal(matchWake("so Michael said"), null);
  assert.equal(matchWake("Michaela is coming"), null);
  assert.equal(matchWake("Michael's car is outside"), null);
  assert.equal(matchWake("my call with Anna"), null);
  assert.equal(matchWake("hey there"), null);
  assert.equal(matchWake(""), null);
});

const seg = (transcript: string, isFinal = false) => ({ isFinal, length: 1, 0: { transcript } });

test("the newest phrase that starts with his name, with whether it is finished", () => {
  const results = [seg("we were talking", true), seg(" hey Michael how is my day")];
  assert.deepEqual(wakeIn({ resultIndex: 1, results }), {
    phrase: "hey Michael how is my day",
    final: false,
  });
  assert.deepEqual(wakeIn({ resultIndex: 0, results: [seg("Michael", true)] }), {
    phrase: "Michael",
    final: true,
  });
  // A name mid sentence, or in a phrase already acted on, does not wake him.
  assert.equal(wakeIn({ resultIndex: 0, results: [seg("then Michael said no", true)] }), null);
  assert.equal(wakeIn({ resultIndex: 1, results: [seg("Michael", true), seg("thanks")] }), null);
});

test("restarts at once after a normal end, backs off after failures, then stops", () => {
  assert.equal(restartDelay(0), 250);
  assert.equal(restartDelay(1), 1000);
  assert.equal(restartDelay(2), 2000);
  assert.equal(restartDelay(MAX_FAILURES), 1000 * 2 ** (MAX_FAILURES - 1));
  assert.equal(restartDelay(MAX_FAILURES + 1), null);
});

test("errors: silence and our own abort are normal, a refusal ends it", () => {
  assert.equal(isQuietWakeError("no-speech"), true);
  assert.equal(isQuietWakeError("aborted"), true);
  assert.equal(isQuietWakeError("network"), false);
  assert.equal(isFatalWakeError("not-allowed"), true);
  assert.equal(isFatalWakeError("service-not-allowed"), true);
  assert.equal(isFatalWakeError("network"), false);
});

test("the stored setting: anything unexpected is off", () => {
  assert.deepEqual(parseSetting(null), { mode: "off" });
  assert.deepEqual(parseSetting("nonsense"), { mode: "off" });
  assert.deepEqual(parseSetting('{"mode":"local"}'), { mode: "off" });
  assert.deepEqual(parseSetting('{"mode":"local","lang":"en-GB"}'), { mode: "local", lang: "en-GB" });
  assert.deepEqual(parseSetting('{"mode":"cloud","lang":"en-GB"}'), { mode: "cloud", lang: "en-GB" });
});

test("why it turned itself off survives a reload; an on setting has no note", () => {
  const mic = "I need the microphone to hear my name.";
  assert.equal(parseNote(JSON.stringify({ mode: "off", note: mic })), mic);
  assert.equal(parseNote('{"mode":"cloud","lang":"en-GB"}'), null);
  assert.equal(parseNote(null), null);
  assert.equal(parseNote("{"), null);
  assert.deepEqual(parseSetting('{"mode":"off","note":"x"}'), { mode: "off" });
});
