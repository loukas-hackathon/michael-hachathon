import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { readWakeDebug, type Wake } from "../../lib/wake-word";
import { listenForWake } from "./wake-loop";

// The wake word's listening loop against a scripted recogniser and a fake clock: how quickly it
// listens again after the browser ends a session, that a wake straight after is heard, and the
// backoff after errors.

type Handler = ((e: unknown) => void) | null;

class FakeRec {
  static all: FakeRec[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: Handler = null;
  onerror: Handler = null;
  onend: Handler = null;
  ended = false;
  startedAt = 0;
  results: { isFinal: boolean; length: number; 0: { transcript: string } }[] = [];
  start() {
    this.startedAt = Date.now();
    FakeRec.all.push(this);
  }
  stop() {
    this.end();
  }
  abort() {
    this.end();
  }
  end() {
    if (this.ended) return;
    this.ended = true;
    this.onend?.({});
  }
  say(text: string, isFinal = false) {
    this.results.push({ isFinal, length: 1, 0: { transcript: text } });
    this.onresult?.({ resultIndex: this.results.length - 1, results: this.results });
  }
  fail(error: string) {
    this.onerror?.({ error });
    this.end();
  }
}

const g = globalThis as unknown as { window?: unknown };
const latest = () => FakeRec.all.at(-1) as FakeRec;

type Seen = { wakes: Wake[]; fatal: string[]; rested: number };

function run(): { seen: Seen; stop: () => void } {
  const seen: Seen = { wakes: [], fatal: [], rested: 0 };
  const stop = listenForWake({
    lang: "en-GB",
    local: false,
    onWake: (w) => seen.wakes.push(w),
    onFatal: (c) => seen.fatal.push(c),
    onRest: () => seen.rested++,
  });
  return { seen, stop };
}

beforeEach(() => {
  FakeRec.all = [];
  g.window = { SpeechRecognition: FakeRec };
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
});

afterEach(() => {
  mock.timers.reset();
  delete g.window;
});

test("after the browser ends a session, the next starts within 300ms", () => {
  const { stop } = run();
  assert.equal(FakeRec.all.length, 1);
  mock.timers.tick(5000);
  latest().end();
  const endedAt = Date.now();
  mock.timers.tick(300);
  assert.equal(FakeRec.all.length, 2);
  assert.ok(latest().startedAt - endedAt <= 300, `restart took ${latest().startedAt - endedAt}ms`);
  assert.equal(readWakeDebug().gapMs, latest().startedAt - endedAt);
  stop();
});

test("a wake within a second of the restart is not lost", () => {
  const { seen, stop } = run();
  mock.timers.tick(5000);
  latest().end();
  mock.timers.tick(300);
  mock.timers.tick(600);
  latest().say("yo Michael what's next", true);
  assert.deepEqual(seen.wakes, [{ first: "What's next" }]);
  stop();
});

test("the browser ends the session mid phrase, after the name: he still wakes", () => {
  const { seen, stop } = run();
  mock.timers.tick(1500);
  latest().say("hey Michael how is my");
  latest().end();
  assert.deepEqual(seen.wakes, [{ first: "How is my" }]);
  // Woken: the loop has let go of the microphone for the conversation.
  mock.timers.tick(2000);
  assert.equal(FakeRec.all.length, 1);
  stop();
});

test("the name split across the restart: the next session hears it whole", () => {
  const { seen, stop } = run();
  mock.timers.tick(3000);
  latest().say("yo");
  latest().end();
  mock.timers.tick(300);
  latest().say("Michael block an hour for the gym", true);
  assert.deepEqual(seen.wakes, [{ first: "Block an hour for the gym" }]);
  stop();
});

test("errors back off; a clean session afterwards is back to an instant restart", () => {
  const { stop } = run();
  latest().fail("network");
  mock.timers.tick(999);
  assert.equal(FakeRec.all.length, 1);
  mock.timers.tick(1);
  assert.equal(FakeRec.all.length, 2);
  latest().fail("network");
  mock.timers.tick(1999);
  assert.equal(FakeRec.all.length, 2);
  mock.timers.tick(1);
  assert.equal(FakeRec.all.length, 3);
  // This one heard something and ran its course.
  latest().say("we were talking");
  mock.timers.tick(4000);
  latest().end();
  mock.timers.tick(100);
  assert.equal(FakeRec.all.length, 4);
  stop();
});

test("iPhone Safari's quick ends restart at once, then back off, then rest", () => {
  const { seen, stop } = run();
  for (let i = 0; i < 4; i++) {
    mock.timers.tick(500);
    latest().end();
    mock.timers.tick(100);
  }
  assert.equal(FakeRec.all.length, 5);
  mock.timers.tick(500);
  latest().end();
  mock.timers.tick(999);
  assert.equal(FakeRec.all.length, 5);
  mock.timers.tick(1);
  assert.equal(FakeRec.all.length, 6);
  // A long run of them stops it trying until the app is opened again: each new session ends as
  // soon as it starts.
  for (let i = 0; i < 20 && !seen.rested; i++) {
    latest().end();
    const n = FakeRec.all.length;
    for (let k = 0; k < 700 && FakeRec.all.length === n && !seen.rested; k++) mock.timers.tick(100);
  }
  assert.equal(seen.rested, 1);
  stop();
});

test("a refused microphone stops it for good and says why", () => {
  const { seen } = run();
  latest().fail("not-allowed");
  mock.timers.tick(60_000);
  assert.deepEqual(seen.fatal, ["not-allowed"]);
  assert.equal(FakeRec.all.length, 1);
});

test("stop drops the recogniser and nothing restarts", () => {
  const { stop } = run();
  stop();
  assert.equal(latest().ended, true);
  mock.timers.tick(60_000);
  assert.equal(FakeRec.all.length, 1);
});
