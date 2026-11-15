import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { API_URL, enterDemo, expect, test } from "./fixtures";

// #463: no text is ever drawn on other text on the Timeline, on any day. A busy real calendar
// showed letters on top of each other where the demo week had none, so this builds a stress day
// for a fresh test user (four events at once, one inside another, 5, 10 and 15 minute blocks, back
// to back, Michael over a meeting, logged time, a workout over a plan, a nap, Mac blocks, places, a
// drive, a running Focus now, long and Greek titles, all day events, the phone lane), then checks
// every visible leaf text in the timeline at phone and laptop sizes. It also runs on each day of the
// demo week and on an empty day.

/** Overlap allowed in both axes before two texts count as drawn on each other. */
const SLACK = 3;

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "laptop", width: 1280, height: 800, mobile: false },
] as const;

const athensDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

/** "+02:00" or "+03:00": Athens' offset on that day. */
function athensOffset(date: string): string {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", timeZoneName: "shortOffset" })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{1,2})/.exec(name ?? "");
  return m ? `${m[1]}${(m[2] ?? "0").padStart(2, "0")}:00` : "+02:00";
}

type Text = { text: string; x: number; y: number; w: number; h: number };

/**
 * Every visible leaf text in the timeline: an element with its own text, measured by the text's
 * own box, cut to every ancestor that clips (a truncated title is only as wide as it shows).
 * The screen reader list (sr-only) and anything with no area left are not drawn, so they are out.
 */
async function textsOf(page: Page): Promise<Text[]> {
  return page.locator("#day-timeline").evaluate((root) => {
    const out: { text: string; x: number; y: number; w: number; h: number }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.currentNode as Element | null; n; n = walker.nextNode() as Element | null) {
      const el = n as HTMLElement;
      const own = [...el.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE && c.textContent?.trim());
      if (own.length === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      let box: { l: number; t: number; r: number; b: number } | null = null;
      for (const c of own) {
        const range = document.createRange();
        range.selectNodeContents(c);
        const r = range.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        box = box
          ? {
              l: Math.min(box.l, r.left),
              t: Math.min(box.t, r.top),
              r: Math.max(box.r, r.right),
              b: Math.max(box.b, r.bottom),
            }
          : { l: r.left, t: r.top, r: r.right, b: r.bottom };
      }
      if (!box) continue;
      // Cut to the element itself and to every ancestor that clips.
      for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (a !== el && s.overflow === "visible" && s.clip === "auto") continue;
        if (Number(s.opacity) === 0) box = null;
        if (!box) break;
        const r = a.getBoundingClientRect();
        box = {
          l: Math.max(box.l, r.left),
          t: Math.max(box.t, r.top),
          r: Math.min(box.r, r.right),
          b: Math.min(box.b, r.bottom),
        };
        if (box.r - box.l < 1 || box.b - box.t < 1) box = null;
      }
      if (!box) continue;
      out.push({
        text: (el.textContent ?? "").trim().slice(0, 60),
        x: box.l + window.scrollX,
        y: box.t + window.scrollY,
        w: box.r - box.l,
        h: box.b - box.t,
      });
    }
    return out;
  });
}

function overlaps(texts: Text[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i] as Text;
      const b = texts[j] as Text;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > SLACK && oy > SLACK)
        found.push(`"${a.text}" and "${b.text}" overlap ${Math.round(ox)}x${Math.round(oy)} px`);
    }
  }
  return found;
}

async function expectNoOverlap(page: Page, label: string) {
  await expect(page.locator("#day-timeline")).toBeVisible();
  // TIMELINE_SHOTS=<folder> saves each day, for a PR's before and after (never set in CI).
  const shots = process.env.TIMELINE_SHOTS;
  if (shots) {
    await page.addStyleTag({ content: "#m-splash{display:none!important}" });
    const name = `${label.replace(/\W+/g, "-")}-${page.viewportSize()?.width}.png`;
    await page.locator("main").screenshot({ path: `${shots}/${name}` });
  }
  const texts = await textsOf(page);
  expect.soft(overlaps(texts), `${label}: text drawn on text`).toEqual([]);
}

/** A fresh test user with an in-memory account of their own (E2E_TEST_AUTH), never the demo. */
async function freshUser(context: BrowserContext, baseURL: string | undefined) {
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  const asUser = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer e2e_${user}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return (res.status === 204 ? null : await res.json()) as T;
  };
  await asUser("/v1/me/data", "DELETE");
  await asUser("/v1/profile", "PUT", { onboarded_at: new Date().toISOString() });
  return asUser;
}

/** The stress day: today, so the now line and a running Focus now session are on it. */
function stressEvents(date: string) {
  const off = athensOffset(date);
  const at = (hm: string, plusDays = 0) => {
    const d = plusDays ? athensDateFrom(date, plusDays) : date;
    return `${d}T${hm}:00${off}`;
  };
  let n = 0;
  const ev = (
    source: string,
    type: string,
    from: string,
    to: string,
    title: string,
    data: Record<string, unknown> = {},
  ) => ({ source, type, start_at: at(from), end_at: at(to), title, data, external_id: `stress:${n++}` });
  const cal = (from: string, to: string, title: string, data: Record<string, unknown> = {}) =>
    ev("google_calendar", "calendar_event", from, to, title, data);
  const mac = (from: string, to: string, app: string, bundle: string) =>
    ev("macos_usage", "app_usage", from, to, app, { bundle_id: bundle, device: "mac" });
  const phone = (from: string, to: string, app: string) =>
    ev("iphone_usage", "app_usage", from, to, app, { device: "iphone" });
  return [
    // All day events: not drawn on the hours, but they must not break anything.
    {
      ...cal("00:00", "00:00", "Ονομαστική εορτή Γιώργου", { all_day: true }),
      end_at: at("00:00", 1),
    },
    {
      ...cal("00:00", "00:00", "Company offsite week, all hands, bring the laptop", { all_day: true }),
      end_at: at("00:00", 1),
    },
    // Logged time on a planned block.
    cal("07:00", "08:00", "Write the investor memo"),
    ev("manual", "focus_session", "07:00", "07:45", "Did Write the investor memo, 45m from 07:00", {
      log: "done",
    }),
    // Slack eats the morning.
    mac("08:10", "08:40", "Slack", "com.tinyspeck.slackmacgap"),
    // Four events at the same time, one of them staggered.
    cal("09:00", "10:00", "Board prep"),
    cal(
      "09:00",
      "10:00",
      "Investor call with Northwind Capital about the Series A follow up and the data room",
      {
        attendees: 4,
      },
    ),
    cal("09:00", "10:00", "Συνάντηση με τον λογιστή για τον ΦΠΑ του τριμήνου", { attendees: 2 }),
    cal("09:15", "09:45", "Design review", { attendees: 3 }),
    mac("09:05", "09:50", "Cursor", "com.todesktop.230313mzl4w4u92"),
    // Mac focus with a WhatsApp stretch inside, and Claude Code beside it.
    mac("10:00", "10:20", "Xcode", "com.apple.dt.Xcode"),
    mac("10:20", "10:27", "WhatsApp", "net.whatsapp.WhatsApp"),
    mac("10:27", "10:55", "Xcode", "com.apple.dt.Xcode"),
    ev("claude_code", "ai_session", "10:00", "11:00", "Fix the score", { tool: "claude_code" }),
    // Logged time over the Mac block, and a five minute nap right after it.
    ev("manual", "focus_session", "10:30", "10:50", "Did Read the term sheet, 20 min from 10:30", {
      log: "done",
    }),
    ev("health_auto_export", "sleep", "10:56", "11:01", "Sleep 5m", { duration_min: 5 }),
    // An event fully inside another.
    cal("11:00", "13:00", "Offsite planning with the whole leadership team"),
    cal("11:30", "12:00", "Quick sync", { attendees: 2 }),
    // 5, 10 and 15 minute events, back to back.
    cal("13:00", "13:05", "Standup"),
    cal("13:05", "13:15", "Check in with Eleni"),
    cal("13:15", "13:30", "Pairing on the onboarding flow"),
    // Back to back half hours.
    cal("14:00", "14:30", "Product review"),
    cal("14:30", "15:00", "Hiring loop: senior engineer"),
    cal("15:00", "15:30", "Ops"),
    // A nap.
    ev("health_auto_export", "sleep", "15:35", "16:00", "Sleep 25m", { duration_min: 25 }),
    // Michael's block on top of a meeting with other people.
    ev("agent", "calendar_event", "16:00", "17:00", "Deep work: pitch deck", { michael: true }),
    cal("16:00", "16:45", "Call with Dimitris", { attendees: 3 }),
    // A drive, with real Mac use under it.
    ev("maps", "travel", "17:15", "17:45", "Drive to the gym", {
      to: { label: "Gym" },
      minutes: 30,
      free_flow_minutes: 18,
    }),
    mac("17:20", "17:40", "Mail", "com.apple.mail"),
    // A workout over a plan.
    cal("18:00", "19:00", "Gym"),
    ev("health_auto_export", "workout", "18:05", "18:55", "Traditional Strength Training 50m", {
      name: "Traditional Strength Training",
      duration_min: 50,
      active_kcal: 410,
      avg_hr: 128,
    }),
    // Where you are.
    ev("location", "location", "08:00", "13:35", "Office, Ermou 12", { place_key: "office" }),
    ev("location", "location", "13:40", "17:10", "Home", { place_key: "home" }),
    ev("location", "location", "17:50", "19:10", "Ημιθέου 5, Παγκράτι", { place_key: "gym" }),
    // The phone lane.
    phone("08:15", "08:20", "Instagram"),
    phone("09:30", "09:33", "WhatsApp"),
    phone("12:10", "12:25", "Instagram"),
    phone("13:02", "13:04", "Messages"),
    phone("16:20", "16:30", "X"),
  ];
}

function athensDateFrom(date: string, plusDays: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });

    test("the stress day and an empty day: no text on text", async ({ page, context, baseURL }) => {
      const asUser = await freshUser(context, baseURL);
      const today = athensDate();
      const goal = await asUser<{ id: string }>("/v1/goals", "POST", {
        category: "personal",
        title: "University",
        weekly_budget_minutes: 360,
      });
      const res = await asUser<{ inserted: number; ignored: number }>("/v1/events/batch", "POST", {
        events: stressEvents(today),
      });
      expect(res.ignored, "every stress event is stored").toBe(0);
      // A running Focus now session (#404), from now.
      await asUser("/v1/focus/start", "POST", { goal_id: goal.id, minutes: 45 });

      await page.goto(`/timeline?day=${today}`);
      await expect(page.getByRole("button", { name: /^Board prep, 09:00 to 10:00/ })).toBeAttached();
      await expectNoOverlap(page, `stress day ${today}`);

      await page.goto(`/timeline?day=${athensDate(20)}`);
      await expectNoOverlap(page, "empty day");
    });

    test("every day of the demo week: no text on text", async ({ page }) => {
      test.setTimeout(90_000);
      await enterDemo(page);
      for (let d = -6; d <= 2; d++) {
        const date = athensDate(d);
        await page.goto(`/timeline?day=${date}`);
        if ((await page.locator("#day-timeline").count()) === 0) continue;
        await expectNoOverlap(page, `demo ${date}`);
      }
    });
  });
}
