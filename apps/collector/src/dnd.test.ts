import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { DndKeeper, listsShortcut } from "./dnd";
import type { Runner } from "./focus-guard";

const NOW = Date.parse("2026-11-17T11:10:00Z"); // 13:10 in Athens
const UNTIL = "2026-11-17T12:00:00.000Z"; // 14:00 in Athens
const ID = "6d0f7d8e-5b8a-4a43-9a51-0d8f3c1c0a47";

/** A fake Mac: records every command, and what the input file held when the shortcut ran. */
function fakeMac(opts: { installed?: boolean; runFails?: boolean } = {}) {
  const calls: string[][] = [];
  const inputs: string[] = [];
  const paths: string[] = [];
  const run: Runner = async (file, args) => {
    calls.push([file, ...args]);
    if (file === "shortcuts" && args[0] === "list") {
      return opts.installed === false ? "Take a Break\nMichael Focus 2\n" : "Take a Break\nMichael Focus\n";
    }
    if (file === "shortcuts" && args[0] === "run") {
      const path = args[args.indexOf("--input-path") + 1] as string;
      paths.push(path);
      inputs.push(readFileSync(path, "utf8"));
      if (opts.runFails) throw new Error("Couldn’t find shortcut");
    }
    return "";
  };
  return { run, calls, inputs, paths };
}

function keeper(mac: ReturnType<typeof fakeMac>, answers: unknown[]) {
  const urls: string[] = [];
  let clock = NOW;
  const fetchFn = (async (url: string) => {
    urls.push(String(url));
    const body = answers.length > 1 ? answers.shift() : answers[0];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const k = new DndKeeper({
    apiUrl: "http://api",
    apiKey: "mk_test",
    run: mac.run,
    fetch: fetchFn,
    log: () => {},
    now: () => clock,
    timeZone: "Europe/Athens",
  });
  return { k, urls, at: (ms: number) => (clock = ms) };
}

const answer = (dnd: { id: string; until: string } | null) => ({
  now: new Date(NOW).toISOString(),
  off_the_record: false,
  guards: [],
  dnd,
});

test("asked for: the shortcut runs once with the local time to end, and never again for the same one", async () => {
  const mac = fakeMac();
  const { k, urls } = keeper(mac, [answer({ id: ID, until: UNTIL })]);
  assert.equal(await k.tick(), "on");
  assert.deepEqual(mac.inputs, ["2026-11-17 14:00"]);
  assert.deepEqual(mac.calls.at(-1)?.slice(0, 4), ["shortcuts", "run", "Michael Focus", "--input-path"]);
  // The input file is the collector's own and is gone after the run.
  assert.equal(existsSync(mac.paths[0] as string), false);
  assert.equal(urls[0], "http://api/v1/focus-guards/active?dnd=ready");
  assert.equal(await k.tick(), "nothing");
  assert.equal(mac.inputs.length, 1);
});

test("nothing asked for: nothing runs", async () => {
  const mac = fakeMac();
  const { k } = keeper(mac, [answer(null)]);
  assert.equal(await k.tick(), "nothing");
  assert.equal(mac.inputs.length, 0);
});

test("ended in Michael before its time: this Mac switches off what it switched on", async () => {
  const mac = fakeMac();
  const { k } = keeper(mac, [answer({ id: ID, until: UNTIL }), answer(null)]);
  assert.equal(await k.tick(), "on");
  assert.equal(await k.tick(), "off");
  assert.deepEqual(mac.inputs, ["2026-11-17 14:00", "off"]);
  assert.equal(await k.tick(), "nothing");
});

test("it ends by itself: after its time nothing is run, not even off", async () => {
  const mac = fakeMac();
  const { k, at } = keeper(mac, [answer({ id: ID, until: UNTIL }), answer(null)]);
  assert.equal(await k.tick(), "on");
  at(Date.parse(UNTIL) + 1000);
  assert.equal(await k.tick(), "ended");
  assert.deepEqual(mac.inputs, ["2026-11-17 14:00"]);
});

test("a Do Not Disturb this Mac did not switch on is never switched off", async () => {
  const mac = fakeMac();
  const { k } = keeper(mac, [answer(null)]);
  assert.equal(await k.tick(), "nothing");
  assert.equal(mac.calls.filter((c) => c[1] === "run").length, 0);
});

test("without the shortcut it says so to the API and runs nothing", async () => {
  const mac = fakeMac({ installed: false });
  const { k, urls } = keeper(mac, [answer({ id: ID, until: UNTIL })]);
  assert.equal(await k.tick(), "missing");
  assert.equal(urls[0], "http://api/v1/focus-guards/active?dnd=missing");
  assert.equal(mac.inputs.length, 0);
  // "Michael Focus 2" is another shortcut: only the exact name counts.
  assert.equal(listsShortcut("Michael Focus 2\n"), false);
  assert.equal(listsShortcut("Add Water\n  Michael Focus  \n"), true);
});

test("a run that fails is tried again on the next look", async () => {
  const mac = fakeMac({ runFails: true });
  const { k } = keeper(mac, [answer({ id: ID, until: UNTIL })]);
  assert.equal(await k.tick(), "failed");
  assert.equal(await k.tick(), "failed");
  assert.equal(mac.inputs.length, 2);
});

test("an API that is away changes nothing", async () => {
  const mac = fakeMac();
  const k = new DndKeeper({
    apiUrl: "http://api",
    apiKey: "mk_test",
    run: mac.run,
    fetch: (async () => {
      throw new Error("offline");
    }) as typeof fetch,
    log: () => {},
    now: () => NOW,
  });
  assert.equal(await k.tick(), "nothing");
  assert.equal(mac.inputs.length, 0);
});
