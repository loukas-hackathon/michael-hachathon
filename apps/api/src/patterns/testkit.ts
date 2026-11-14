import type { Event, Goal } from "@michael/shared";
import { buildPatternReport, type PatternOptions } from "./index";

// Small builders for synthetic timelines. Every app and time in the tests is made up.

let counter = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

/** "2026-11-10 09:00" or "2026-11-10 09:00:30" in Athens winter time (UTC+02:00). */
export const T = (local: string): string => {
  const [day, time = "00:00"] = local.split(" ");
  return `${day}T${time.length === 5 ? `${time}:00` : time}+02:00`;
};

const event = (e: Pick<Event, "source" | "type" | "start_at" | "end_at" | "title" | "data">): Event => ({
  id: nextId(),
  external_id: null,
  created_at: "2026-01-01T00:00:00Z",
  ...e,
});

export const APPS = {
  editor: "com.microsoft.VSCode",
  terminal: "com.apple.Terminal",
  chat: "net.whatsapp.WhatsApp",
  social: "com.burbn.instagram",
  finder: "com.apple.finder",
  browser: "com.google.Chrome",
  tv: "com.apple.TV",
  home: "com.apple.springboard",
  unknown: "com.example.mystery",
} as const;

const NAMES: Record<string, string> = {
  [APPS.editor]: "VS Code",
  [APPS.terminal]: "Terminal",
  [APPS.chat]: "WhatsApp",
  [APPS.social]: "Instagram",
  [APPS.finder]: "Finder",
  [APPS.browser]: "Chrome",
  [APPS.tv]: "TV",
  [APPS.home]: "Home Screen",
  [APPS.unknown]: "Mystery",
};

/** Mac app in front from `start` to `end` (ISO strings). */
export const mac = (bundle: string, start: string, end: string): Event =>
  event({
    source: "macos_usage",
    type: "app_usage",
    start_at: start,
    end_at: end,
    title: NAMES[bundle] ?? bundle,
    data: { bundle_id: bundle, device: "mac", seconds: (Date.parse(end) - Date.parse(start)) / 1000 },
  });

export const phone = (bundle: string, start: string, end: string, openedFrom?: string): Event =>
  event({
    source: "iphone_usage",
    type: "app_usage",
    start_at: start,
    end_at: end,
    title: NAMES[bundle] ?? bundle,
    data: {
      bundle_id: bundle,
      device: "iphone",
      seconds: (Date.parse(end) - Date.parse(start)) / 1000,
      ...(openedFrom ? { opened_from: openedFrom } : {}),
    },
  });

export const web = (
  host: string,
  start: string,
  end: string,
  origin?: "history" | "extension",
  extra: Record<string, unknown> = {},
): Event =>
  event({
    source: "chrome",
    type: "web_visit",
    start_at: start,
    end_at: end,
    title: "A page title that must never reach a summary",
    data: {
      host,
      seconds: (Date.parse(end) - Date.parse(start)) / 1000,
      ...(origin ? { origin } : {}),
      ...extra,
    },
  });

export const search = (term: string, at: string): Event =>
  event({
    source: "chrome",
    type: "search",
    start_at: at,
    end_at: null,
    title: term,
    data: { engine: "google", term },
  });

export const screenOff = (start: string, end: string): Event =>
  event({
    source: "macos_usage",
    type: "screen",
    start_at: start,
    end_at: end,
    title: "Screen off",
    data: { state: "off", device: "mac" },
  });

export const macNotification = (bundle: string, at: string): Event =>
  event({
    source: "macos_usage",
    type: "notification",
    start_at: at,
    end_at: null,
    title: NAMES[bundle] ?? bundle,
    data: { bundle_id: bundle, device: "mac" },
  });

export const sleep = (start: string, end: string): Event =>
  event({ source: "whoop", type: "sleep", start_at: start, end_at: end, title: "Sleep", data: {} });

export const recovery = (at: string, pct: number): Event =>
  event({
    source: "whoop",
    type: "recovery",
    start_at: at,
    end_at: null,
    title: `Recovery ${pct}%`,
    data: { recovery_pct: pct },
  });

export const calendar = (
  title: string,
  start: string,
  end: string,
  data: Record<string, unknown> = {},
): Event =>
  event({ source: "google_calendar", type: "calendar_event", start_at: start, end_at: end, title, data });

export const aiSession = (start: string, end: string, waitingSeconds?: number, tool = "claude_code"): Event =>
  event({
    source: "claude_code",
    type: "ai_session",
    start_at: start,
    end_at: end,
    title: "Session",
    data: {
      tool,
      project: "demo",
      turns: 3,
      ...(waitingSeconds === undefined ? {} : { waiting_seconds: waitingSeconds }),
    },
  });

export const goal = (category: Goal["category"], id: string, title = `${category} goal`): Goal => ({
  id,
  category,
  title,
  description: null,
  target: null,
  weekly_budget_minutes: 600,
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

/** Report over [from, to) in Athens local winter time, with `now` at the end of the range. */
export const report = (events: Event[], from: string, to: string, extra: Partial<PatternOptions> = {}) =>
  buildPatternReport(events, { from: T(from), to: T(to), now: T(to), ...extra });

/** Unwrap a detector that must have data. */
export function dataOf<T>(detector: { status: string; reason: string | null; data: T | null }): T {
  if (detector.data === null) throw new Error(`expected data, got: ${detector.reason}`);
  return detector.data;
}

/**
 * A busy synthetic month for the speed and consistency tests: about 1,470 events a day. The Mac
 * runs a fixed 15 minute loop of 36 second intervals from 08:00 to 18:00 (80% work apps), the
 * phone is picked up every 4 minutes from 07:00 and once late in the evening, the browser logs a
 * visit every 140 seconds from both origins, and six AI sessions run through the day.
 */
export function syntheticMonth(days: number, firstDay = "2026-10-17T00:00:00+03:00"): Event[] {
  const events: Event[] = [];
  const start = Date.parse(firstDay);
  const at = (ms: number) => new Date(ms).toISOString();
  const loop = [
    ...Array(6).fill(APPS.editor),
    ...Array(3).fill(APPS.terminal),
    APPS.chat,
    ...Array(5).fill(APPS.editor),
    APPS.browser,
    APPS.browser,
    APPS.unknown,
    ...Array(4).fill(APPS.editor),
    APPS.tv,
    APPS.terminal,
    APPS.terminal,
  ] as string[];
  const phoneApps = [APPS.chat, APPS.social, APPS.home];
  const hosts = ["github.com", "youtube.com", "skyscanner.net", "private.example"];
  for (let d = 0; d < days; d++) {
    const day = start + d * 86_400_000;
    for (let i = 0; i < 1000; i++) {
      const t = day + 8 * 3600_000 + i * 36_000;
      events.push(mac(loop[i % loop.length] ?? APPS.editor, at(t), at(t + 36_000)));
    }
    for (let i = 0; i < 200; i++) {
      const t = day + 7 * 3600_000 + i * 240_000;
      const opened = i % 3 ? "home_screen" : "notification";
      events.push(phone(phoneApps[(i + d) % phoneApps.length] ?? APPS.chat, at(t), at(t + 40_000), opened));
    }
    events.push(phone(APPS.social, at(day + 23 * 3600_000 + 600_000), at(day + 23 * 3600_000 + 2_400_000)));
    for (let i = 0; i < 250; i++) {
      const t = day + 8 * 3600_000 + i * 140_000;
      events.push(
        web(hosts[i % hosts.length] ?? "github.com", at(t), at(t + 60_000), i % 2 ? "extension" : "history"),
      );
      if (i % 25 === 0) events.push(search("a made up search", at(t - 20_000)));
    }
    for (let i = 0; i < 6; i++) {
      const t = day + (9 + i) * 3600_000;
      events.push(aiSession(at(t), at(t + 50 * 60_000), 300));
    }
    events.push(sleep(at(day - 10 * 60_000), at(day + 6.5 * 3600_000)));
    events.push(recovery(at(day + 7 * 3600_000), 60 + (d % 20)));
  }
  return events;
}
