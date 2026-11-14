import assert from "node:assert/strict";
import { test } from "node:test";
import type { FocusGuard } from "@michael/shared";
import {
  appleScriptString,
  closeApp,
  FocusGuardian,
  guardFor,
  notificationText,
  parseBundleId,
  type Runner,
} from "./focus-guard";

const NOW = Date.parse("2026-11-15T09:30:00Z");
const MIN = 60_000;

const guard = (over: Partial<FocusGuard> = {}): FocusGuard => ({
  id: "6d0f7d8e-5b8a-4a43-9a51-0d8f3c1c0a01",
  recommendation_id: null,
  apps: ["WhatsApp"],
  bundle_ids: ["net.whatsapp.WhatsApp", "desktop.WhatsApp"],
  start_at: new Date(NOW - 10 * MIN).toISOString(),
  end_at: new Date(NOW + 30 * MIN).toISOString(),
  goal_id: null,
  back_to: "The company",
  created_at: new Date(NOW - 20 * MIN).toISOString(),
  ...over,
});

/** A fake Mac: `front` is the app in front; every command is recorded; osascript can be made to fail. */
function fakeMac(front: string | null, opts: { quitFails?: boolean } = {}) {
  const calls: string[][] = [];
  const run: Runner = async (file, args) => {
    calls.push([file, ...args]);
    if (file === "lsappinfo" && args[0] === "front") return front ? "ASN:0x0-0x1d01d:\n" : "";
    if (file === "lsappinfo") return front ? `"CFBundleIdentifier"="${front}"\n` : "";
    if (file === "osascript" && opts.quitFails && args[1]?.includes("to quit")) throw new Error("-1743");
    return "";
  };
  return { run, calls, scripts: () => calls.filter((c) => c[0] === "osascript").map((c) => c[2]) };
}

function guardian(front: string | null, body: unknown, opts: { quitFails?: boolean } = {}) {
  const mac = fakeMac(front, opts);
  const fetchFn = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
  const g = new FocusGuardian({
    apiUrl: "http://api",
    apiKey: "mk_test",
    run: mac.run,
    fetch: fetchFn,
    log: () => {},
    now: () => NOW,
    timeZone: "Europe/Athens",
  });
  return { g, mac };
}

test("parses the front app's bundle id from lsappinfo", () => {
  assert.equal(parseBundleId('"CFBundleIdentifier"="net.whatsapp.WhatsApp"'), "net.whatsapp.WhatsApp");
  assert.equal(parseBundleId("nothing here"), null);
});

test("the notification names the app, the end time and the goal", () => {
  const text = notificationText("Instagram", guard({ end_at: "2026-11-15T10:00:00Z" }), "Europe/Athens");
  assert.equal(text, "Instagram is off until 12:00. Back to The company.");
  assert.equal(
    notificationText("Slack", guard({ end_at: "2026-11-15T10:00:00Z", back_to: null }), "Europe/Athens"),
    "Slack is off until 12:00.",
  );
});

test("AppleScript strings are escaped", () => {
  assert.equal(appleScriptString('say "hi" \\ bye\nnow'), '"say \\"hi\\" \\\\ bye now"');
});

test("a guard only matches while it runs, and only allowlisted apps", () => {
  const g = guard();
  assert.equal(guardFor([g], "net.whatsapp.WhatsApp", NOW)?.id, g.id);
  assert.equal(guardFor([g], "NET.WHATSAPP.WHATSAPP", NOW)?.id, g.id);
  assert.equal(guardFor([g], "net.whatsapp.WhatsApp", NOW + 31 * MIN), null, "after the end");
  assert.equal(guardFor([g], "net.whatsapp.WhatsApp", NOW - 11 * MIN), null, "before the start");
  assert.equal(guardFor([g], "com.tinyspeck.slackmacgap", NOW), null, "not in this guard");
  // A tampered guard naming system or Michael's own apps never matches.
  const bad = guard({
    bundle_ids: ["com.apple.finder", "com.apple.Terminal", "com.anthropic.claudefordesktop"],
  });
  for (const id of bad.bundle_ids) assert.equal(guardFor([bad], id, NOW), null, id);
});

test("closeApp quits gracefully, hides when quitting is not allowed, and never touches system apps", async () => {
  const ok = fakeMac(null);
  assert.equal(await closeApp(ok.run, "net.whatsapp.WhatsApp"), "quit");
  assert.deepEqual(ok.scripts(), ['tell application id "net.whatsapp.WhatsApp" to quit']);

  const denied = fakeMac(null, { quitFails: true });
  assert.equal(await closeApp(denied.run, "net.whatsapp.WhatsApp"), "hidden");
  assert.match(denied.scripts()[1] ?? "", /set visible .* to false/);

  for (const id of [
    "com.apple.finder",
    "com.apple.dock",
    "com.apple.Terminal",
    "com.anthropic.claudefordesktop",
  ]) {
    const mac = fakeMac(null);
    assert.equal(await closeApp(mac.run, id), "failed");
    assert.equal(mac.calls.length, 0, `${id} must not be touched`);
  }
});

test("during a guard the muted app in front is quit and the person told why, once a minute", async () => {
  const { g, mac } = guardian("net.whatsapp.WhatsApp", { now: "", off_the_record: false, guards: [guard()] });
  await g.refresh();
  assert.equal(g.active(), true);
  assert.deepEqual(await g.tick(), { bundleId: "net.whatsapp.WhatsApp", result: "quit" });
  const scripts = mac.scripts();
  assert.equal(scripts[0], 'tell application id "net.whatsapp.WhatsApp" to quit');
  assert.equal(
    scripts[1],
    'display notification "WhatsApp is off until 12:00. Back to The company." with title "Michael"',
  );
  await g.tick();
  assert.equal(
    mac.scripts().filter((s) => s?.startsWith("display")).length,
    1,
    "no second notice within a minute",
  );
});

test("an app that is not muted is left alone", async () => {
  const { g, mac } = guardian("com.microsoft.VSCode", { off_the_record: false, guards: [guard()] });
  await g.refresh();
  assert.equal(await g.tick(), null);
  assert.equal(mac.scripts().length, 0);
});

test("off the record: no guards, and nothing on the Mac is even looked at", async () => {
  const { g, mac } = guardian("net.whatsapp.WhatsApp", { off_the_record: true, guards: [guard()] });
  await g.refresh();
  assert.equal(g.active(), false);
  assert.equal(await g.tick(), null);
  assert.equal(mac.calls.length, 0);
});

test("a failed refresh keeps the last list; no guard means no checks", async () => {
  const mac = fakeMac("net.whatsapp.WhatsApp");
  let fail = false;
  const fetchFn = (async () => {
    if (fail) throw new Error("offline");
    return new Response(JSON.stringify({ off_the_record: false, guards: [] }), { status: 200 });
  }) as typeof fetch;
  const g = new FocusGuardian({
    apiUrl: "http://api",
    apiKey: "k",
    run: mac.run,
    fetch: fetchFn,
    log: () => {},
    now: () => NOW,
  });
  await g.refresh();
  fail = true;
  await g.refresh();
  assert.equal(g.active(), false);
  assert.equal(await g.tick(), null);
  assert.equal(mac.calls.length, 0);
});
