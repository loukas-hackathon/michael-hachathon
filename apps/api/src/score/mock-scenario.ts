import { type Event, type Goal, mockGoals } from "@michael/shared";

// The made up week behind `mockScore` in packages/shared/src/mocks.ts: the same Wednesday the web
// app's sample day tells (planned 310 minutes; at 15:20 spent 213, lost 47, 50 ahead, 82% so far,
// 64% for the week, 47 minutes won back). `mock.test.ts` checks that the mock is exactly what the
// score functions return for these events, so the mock cannot drift from the real shape.
//
// To refresh the mock after a rule change, print
//   buildScore(scenario.events, scenario.goals, scenario)
// and paste it over `mockScore`.

const at = (day: string, time: string) => `2026-11-${day}T${time}:00+02:00`;

const APPS = {
  code: { bundle: "com.microsoft.VSCode", name: "VS Code", source: "macos_usage" },
  notion: { bundle: "notion.id", name: "Notion", source: "macos_usage" },
  mail: { bundle: "com.apple.mail", name: "Mail", source: "macos_usage" },
  whatsapp: { bundle: "net.whatsapp.WhatsApp", name: "WhatsApp", source: "iphone_usage" },
  instagram: { bundle: "com.burbn.instagram", name: "Instagram", source: "iphone_usage" },
} as const;

type App = keyof typeof APPS;

export function mockScoreScenario(): { events: Event[]; goals: Goal[]; date: string; now: string } {
  const events: Event[] = [];
  const push = (e: Pick<Event, "source" | "type" | "start_at" | "end_at" | "title" | "data">) =>
    events.push({
      id: `40000000-0000-4000-8000-${String(events.length + 1).padStart(12, "0")}`,
      external_id: null,
      created_at: "2026-11-01T00:00:00.000Z",
      ...e,
    });
  const use = (app: App, day: string, from: string, to: string) => {
    const { bundle, name, source } = APPS[app];
    const device = source === "iphone_usage" ? "iphone" : "mac";
    const seconds = (Date.parse(at(day, to)) - Date.parse(at(day, from))) / 1000;
    push({
      source,
      type: "app_usage",
      start_at: at(day, from),
      end_at: at(day, to),
      title: name,
      data: { bundle_id: bundle, device, seconds },
    });
  };
  /** A planned block with a work app in front for all of it; what is lost comes on top. */
  const block = (title: string, day: string, from: string, to: string, app?: App) => {
    push({
      source: "google_calendar",
      type: "calendar_event",
      start_at: at(day, from),
      end_at: at(day, to),
      title,
      data: { attendees: 0 },
    });
    if (app) use(app, day, from, to);
  };

  // The two days before the week, for the usual day: 41 minutes lost of 240.
  block("Deep work", "05", "09:00", "11:00", "code");
  use("instagram", "05", "09:30", "09:50");
  block("Deep work", "06", "09:00", "11:00", "code");
  use("instagram", "06", "10:00", "10:21");

  // Monday: 87 lost of 180. The gym hour has a workout to prove it.
  block("Deep work", "09", "09:00", "11:00", "code");
  use("instagram", "09", "09:10", "09:50");
  use("whatsapp", "09", "10:15", "10:52");
  block("Gym", "09", "18:00", "19:00");
  push({
    source: "health_auto_export",
    type: "workout",
    start_at: at("09", "18:00"),
    end_at: at("09", "19:00"),
    title: "Strength training",
    data: {},
  });
  use("instagram", "09", "18:30", "18:40");

  // Tuesday: 100 lost of 210.
  block("Deep work", "10", "09:00", "11:00", "code");
  use("whatsapp", "10", "09:20", "09:45");
  use("instagram", "10", "10:10", "10:45");
  block("Study", "10", "14:00", "15:30", "notion");
  use("instagram", "10", "14:20", "15:00");

  // Wednesday, the day itself: the web sample day's blocks and interruptions.
  block("Deep work", "11", "09:00", "11:00", "code");
  use("whatsapp", "11", "09:42", "09:46");
  use("mail", "11", "10:31", "10:36");
  block("Deep work", "11", "11:30", "12:30", "code");
  use("instagram", "11", "12:05", "12:24");
  block("Study", "11", "14:00", "15:30", "notion");
  use("whatsapp", "11", "14:12", "14:14");
  use("whatsapp", "11", "14:31", "14:42");
  use("instagram", "11", "14:50", "14:52");
  use("whatsapp", "11", "15:02", "15:03");
  use("instagram", "11", "15:09", "15:11");
  use("whatsapp", "11", "15:15", "15:16");
  block("Run", "11", "18:00", "18:40");

  // The rest of the week, still ahead.
  block("Deep work", "12", "09:00", "11:00");
  block("Gym", "12", "18:00", "19:00");
  block("Deep work", "13", "09:00", "11:00");

  // A meeting with other people: never a block, it takes free time (#117).
  push({
    source: "google_calendar",
    type: "calendar_event",
    start_at: at("12", "14:00"),
    end_at: at("12", "15:00"),
    title: "Investor call",
    data: { attendees: 2 },
  });

  // Three nights from the watch, counted on the day they end (#117). Sleep stays outside the score.
  const night = (from: string, fromTime: string, to: string, toTime: string, minutes: number) =>
    push({
      source: "health_auto_export",
      type: "sleep",
      start_at: at(from, fromTime),
      end_at: at(to, toTime),
      title: "Sleep",
      data: { duration_min: minutes },
    });
  night("08", "23:40", "09", "07:05", 431);
  night("09", "23:55", "10", "06:40", 388);
  night("10", "23:20", "11", "07:00", 452);

  return { events, goals: mockGoals, date: "2026-11-11", now: at("11", "15:20") };
}
