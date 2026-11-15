import assert from "node:assert/strict";
import { test } from "node:test";
import { RULES } from "./context";
import { isHeadline } from "./headlines";
import { APPS, aiSession, mac, report, T, web } from "./testkit";

// A detector can answer and still have nothing worth leading with. These keep their data and
// summary but never reach `headlines`.

test("a clean focus morning: 0 minutes of drift and no disruptions are not headlines", () => {
  const r = report(
    [
      mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 10:00")),
      mac(APPS.browser, T("2026-11-10 10:00"), T("2026-11-10 10:10")),
      web("github.com", T("2026-11-10 10:00"), T("2026-11-10 10:10"), "extension"),
    ],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
  );
  // The detectors answered...
  assert.equal(r.drift.status, "ok");
  assert.equal(r.drift.data?.minutes, 0);
  assert.ok(r.drift.summary);
  assert.equal(r.focus_disruptions.status, "ok");
  assert.equal(r.focus_disruptions.data?.disruptions, 0);
  // ...but "No travel, shopping ... browsing" and "0 disruptions a day" do not lead.
  assert.ok(!r.headlines.includes(r.drift.summary ?? ""));
  assert.ok(!r.headlines.includes(r.focus_disruptions.summary ?? ""));
  assert.equal(isHeadline("drift", r.drift), false);
  // 70 minutes of screen time clears its bar.
  assert.ok(r.headlines.includes(r.time_by_app.summary ?? ""));
});

test("drift under 5 minutes is not a headline, from 5 minutes it is", () => {
  const day = (siteMinutes: number) =>
    report(
      [
        mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:40")),
        mac(APPS.browser, T("2026-11-10 09:40"), T(`2026-11-10 09:${40 + siteMinutes}`)),
        web("youtube.com", T("2026-11-10 09:40"), T(`2026-11-10 09:${40 + siteMinutes}`), "extension"),
        mac(APPS.editor, T(`2026-11-10 09:${40 + siteMinutes}`), T("2026-11-10 10:30")),
      ],
      "2026-11-10 00:00",
      "2026-11-11 00:00",
    );
  const small = day(4);
  assert.equal(small.drift.status, "ok");
  assert.equal(small.drift.data?.minutes, 4);
  assert.ok(!small.headlines.includes(small.drift.summary ?? ""));
  const enough = day(RULES.headline.minMinutes);
  assert.equal(enough.drift.data?.minutes, 5);
  assert.ok(enough.headlines.includes(enough.drift.summary ?? ""));
});

test("a short range with a minute of screen time and two AI sessions: no headlines at all", () => {
  const r = report(
    [
      mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:01")),
      aiSession(T("2026-11-10 09:00"), T("2026-11-10 09:20")),
      aiSession(T("2026-11-10 09:30"), T("2026-11-10 09:40")),
    ],
    "2026-11-10 09:00",
    "2026-11-10 10:00",
  );
  assert.equal(r.time_by_app.status, "ok");
  assert.equal(r.ai_tool_use.status, "ok");
  assert.deepEqual(r.headlines, []);
});

test("a detector without data is never a headline", () => {
  const r = report([], "2026-11-10 00:00", "2026-11-11 00:00");
  assert.equal(isHeadline("time_by_app", r.time_by_app), false);
  assert.match(r.time_by_app.reason ?? "", /^Not enough data yet: /);
});
