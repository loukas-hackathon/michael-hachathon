import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceProblems } from "@michael/shared";
import {
  DAY_MS,
  HOME_SCREEN_LINE,
  isFatalWakeError,
  isQuietWakeError,
  MAX_FAILURES,
  matchWake,
  micBlockedLine,
  NO_RECOGNISER_LINE,
  nextRestart,
  OFFER_HOLD_ON_LINE,
  OFFER_ON_LINE,
  OFFER_WAKE_LINE,
  offerKind,
  parseNote,
  parseSetting,
  QUICK_FREE,
  RESTART_MS,
  restartDelay,
  supportLine,
  type WakeEnv,
  wakeIn,
  wakeSupport,
  wantsVoiceDebug,
} from "./wake-word";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:140.0) Gecko/20100101 Firefox/140.0",
};

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
  assert.equal(restartDelay(0), RESTART_MS);
  assert.ok(RESTART_MS <= 300);
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

test("a normal end restarts within 300ms and resets the counts", () => {
  assert.deepEqual(nextRestart({ failures: 3, quick: 2 }, { errored: false, short: false }), {
    failures: 0,
    quick: 0,
    delay: RESTART_MS,
  });
});

test("errors back off 1, 2, 4 seconds and rest after MAX_FAILURES", () => {
  let count = { failures: 0, quick: 0 };
  const delays: (number | null)[] = [];
  for (let i = 0; i <= MAX_FAILURES; i++) {
    const next = nextRestart(count, { errored: true, short: false });
    delays.push(next.delay);
    count = next;
  }
  assert.deepEqual(delays.slice(0, 3), [1000, 2000, 4000]);
  assert.equal(delays.at(-1), null);
});

test("quick clean ends (iPhone Safari) restart at once before they back off", () => {
  let count = { failures: 0, quick: 0 };
  for (let i = 0; i < QUICK_FREE; i++) {
    const next = nextRestart(count, { errored: false, short: true });
    assert.equal(next.delay, RESTART_MS, `quick end ${i + 1}`);
    count = next;
  }
  assert.equal(nextRestart(count, { errored: false, short: true }).delay, 1000);
  // One session that heard something puts it back to normal.
  assert.deepEqual(nextRestart(count, { errored: false, short: false }).quick, 0);
});

const env = (patch: Partial<WakeEnv>): WakeEnv => ({
  recognition: true,
  refused: false,
  iosHomeScreen: false,
  mic: "prompt",
  ...patch,
});

test("where the wake word can run, and the one line that says why not", () => {
  assert.equal(wakeSupport(env({})), "ok");
  assert.equal(wakeSupport(env({ mic: "granted" })), "ok");
  // The iPhone Home Screen app: iOS refuses web speech recognition there, whatever it exposes.
  assert.equal(wakeSupport(env({ iosHomeScreen: true })), "home-screen");
  assert.equal(wakeSupport(env({ recognition: false })), "no-recogniser");
  assert.equal(wakeSupport(env({ refused: true })), "no-recogniser");
  assert.equal(wakeSupport(env({ mic: "denied" })), "mic-blocked");

  assert.equal(supportLine("ok", UA.macChrome), null);
  assert.equal(
    supportLine("home-screen", UA.iphoneSafari),
    "On iPhone, hold the Mi button to talk. Saying my name needs Safari or Chrome.",
  );
  assert.equal(supportLine("no-recogniser", UA.firefox), NO_RECOGNISER_LINE);
  assert.equal(supportLine("mic-blocked", UA.macChrome), micBlockedLine(UA.macChrome));
});

test("a blocked microphone: how to allow it, for the browser in hand", () => {
  assert.match(micBlockedLine(UA.iphoneSafari), /aA.*Website Settings.*Microphone/);
  assert.match(micBlockedLine(UA.iphoneChrome), /Settings, Apps, Chrome, Microphone/);
  assert.match(micBlockedLine(UA.macSafari), /Safari menu/);
  assert.match(micBlockedLine(UA.macChrome), /^Microphone blocked\. Click the icon left of the address/);
  assert.match(micBlockedLine(UA.android), /^Microphone blocked\. Tap the icon left of the address/);
  assert.match(micBlockedLine(UA.firefox), /Click the icon/);
  assert.match(micBlockedLine("curl/8"), /browser settings/);
});

test("the offer: once on Chat, on Today only after a day without Chat, never after a choice", () => {
  const base = {
    place: "chat" as const,
    choice: null,
    wakeOn: false,
    chatOpened: false,
    firstSeen: 1000,
    now: 1000,
    support: "ok" as const,
  };
  assert.equal(offerKind(base), "wake");
  assert.equal(offerKind({ ...base, choice: "no" }), null);
  assert.equal(offerKind({ ...base, choice: "on" }), null);
  assert.equal(offerKind({ ...base, wakeOn: true }), null);
  // Where saying his name cannot work, holding the Mi button is offered instead.
  assert.equal(offerKind({ ...base, support: "home-screen" }), "hold");
  assert.equal(offerKind({ ...base, support: "no-recogniser" }), "hold");
  assert.equal(offerKind({ ...base, support: "mic-blocked" }), "blocked");

  const today = { ...base, place: "today" as const };
  assert.equal(offerKind(today), null, "the first day: not yet");
  assert.equal(offerKind({ ...today, now: 1000 + DAY_MS }), "wake", "a day later");
  assert.equal(offerKind({ ...today, now: 1000 + DAY_MS, chatOpened: true }), null, "Chat asked already");
  assert.equal(offerKind({ ...today, firstSeen: null, now: 1000 + DAY_MS }), null);
});

test("the diagnostic shows only with ?debug=voice, and stays for the visit", () => {
  assert.equal(wantsVoiceDebug("", false), false);
  assert.equal(wantsVoiceDebug("?debug=voice", false), true);
  assert.equal(wantsVoiceDebug("?x=1", true), true);
  assert.equal(wantsVoiceDebug("?debug=off", true), false);
});

test("every line he says about it keeps his voice", () => {
  const lines = [
    HOME_SCREEN_LINE,
    NO_RECOGNISER_LINE,
    OFFER_WAKE_LINE,
    OFFER_ON_LINE,
    OFFER_HOLD_ON_LINE,
    ...Object.values(UA).map(micBlockedLine),
    micBlockedLine(""),
  ];
  for (const line of lines) assert.deepEqual(voiceProblems(line), [], line);
});
