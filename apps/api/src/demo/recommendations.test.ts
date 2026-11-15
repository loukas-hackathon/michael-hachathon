import assert from "node:assert/strict";
import { test } from "node:test";
import { demoRecommendations } from "@michael/shared";

// Found by the end-to-end suite: on a Saturday evening the demo suggested a Sunday focus block, and
// the demo's own "Keep Sundays clear" refused it when the user tapped Do it. The demo plan no
// longer clears Sundays (demo/sunday.test.ts), but a user who does must still never be offered one.
const weekday = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", weekday: "short" }).format(new Date(iso));

test("demo suggestions Michael can carry out never land on a Sunday", () => {
  for (const now of ["2026-11-14T18:30:00Z", "2026-11-15T04:00:00Z", "2026-11-14T05:00:00Z"]) {
    for (const rec of demoRecommendations(new Date(now))) {
      const start = rec.action?.payload.start_at;
      if (rec.action?.kind !== "create_focus_block" || typeof start !== "string") continue;
      assert.notEqual(weekday(start), "Sun", `${rec.title} at ${start} (now ${now})`);
      assert.ok(Date.parse(start) > Date.parse(now), `${rec.title} starts in the future`);
    }
  }
});
