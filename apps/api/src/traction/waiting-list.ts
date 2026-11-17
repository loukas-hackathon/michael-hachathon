import type { TractionWaitingList, WaitlistEntry } from "@michael/shared";
import { Zone } from "../patterns/time";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

// The waiting list as investor numbers (GET /v1/admin/traction, `waiting_list`): counts and shares
// only. Nothing per person leaves here: no name, no email, no referral code.

const DAY = 24 * 60 * 60 * 1000;
/** The daily series never runs longer than a year. */
const MAX_DAYS = 365;
const MAX_SOURCES = 8;
/** Hour buckets: up to 2, 4, 6, 8, then 10 and more. */
const HOUR_EDGES = [2, 4, 6, 8] as const;

/** Our own addresses (team, demo, judges) are never counted, as for accounts. */
export const isOwnWaitlistEntry = (e: Pick<WaitlistEntry, "email">): boolean =>
  e.email.trim().toLowerCase().endsWith("@michael.app");

/** A source as people say it: "t.co" and "x.com" are X, "lnkd.in" is LinkedIn. */
export function sourceName(raw: string | null, referred: boolean): string {
  if (referred) return "a friend";
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "direct";
  const host =
    s
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0] ?? s;
  if (/^(x|twitter)(\.com)?$|^t\.co$|^(mobile\.)?twitter\.com$/.test(host)) return "X";
  if (/linkedin|^lnkd\.in$/.test(host)) return "LinkedIn";
  if (/^(news\.)?ycombinator\.com$|^hn$|hacker ?news/.test(host)) return "Hacker News";
  if (/^(www\.)?google\./.test(host) || host === "google") return "Google";
  if (/producthunt/.test(host)) return "Product Hunt";
  if (/^(l\.)?instagram\.com$|^instagram$/.test(host)) return "Instagram";
  if (/facebook|^fb$/.test(host)) return "Facebook";
  if (/reddit/.test(host)) return "Reddit";
  if (/^mail$|^email$|newsletter/.test(host)) return "email";
  return host;
}

const count = (keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<string, number>;

export function waitingList(
  all: WaitlistEntry[],
  opts: { now: number; timezone: string },
): TractionWaitingList {
  const zone = new Zone(opts.timezone);
  const entries = all.filter((e) => !isOwnWaitlistEntry(e));
  const now = opts.now;
  const at = (e: WaitlistEntry) => Date.parse(e.created_at);
  const last7 = entries.filter((e) => at(e) > now - 7 * DAY && at(e) <= now).length;
  const prev7 = entries.filter((e) => at(e) > now - 14 * DAY && at(e) <= now - 7 * DAY).length;

  // Daily sign ups from the first day to today, oldest first.
  const today = zone.dayOf(now);
  const perDay = new Map<string, number>();
  for (const e of entries) {
    const d = zone.dayOf(at(e));
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const days = [...perDay.keys()].sort();
  const firstDay = days[0] ?? null;
  const by_day: TractionWaitingList["by_day"] = [];
  if (firstDay) {
    let d = firstDay;
    // Start no earlier than a year back.
    const floor = zone.nextDay(today, -(MAX_DAYS - 1));
    if (d < floor) d = floor;
    while (d <= today) {
      by_day.push({ day: d, sign_ups: perDay.get(d) ?? 0 });
      d = zone.nextDay(d, 1);
    }
  }

  // Sources, most first; a friend's link counts as "a friend" whatever the utm said.
  const codes = new Set(entries.map((e) => e.referral_code));
  const referredBy = (e: WaitlistEntry) => !!e.referred_by && codes.has(e.referred_by);
  const sources = new Map<string, number>();
  for (const e of entries) {
    const name = sourceName(e.source, referredBy(e));
    sources.set(name, (sources.get(name) ?? 0) + 1);
  }
  const by_source = [...sources.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_SOURCES)
    .map(([source, sign_ups]) => ({ source, sign_ups }));

  const hours: TractionWaitingList["hours"] = [
    ...HOUR_EDGES.map((up_to) => ({ up_to, people: 0 })),
    { up_to: null, people: 0 },
  ];
  for (const e of entries) {
    const i = HOUR_EDGES.findIndex((edge) => e.hours_lost_per_week <= edge);
    const bucket = hours[i === -1 ? HOUR_EDGES.length : i];
    if (bucket) bucket.people++;
  }

  const by_role = count(["founder", "executive", "employee", "student", "other"]);
  const by_computer = count(["mac", "windows", "linux"]);
  const by_phone = count(["iphone", "android"]);
  const by_calendar = count(["google", "outlook", "other"]);
  for (const e of entries) {
    by_role[e.role] = (by_role[e.role] ?? 0) + 1;
    by_computer[e.computer] = (by_computer[e.computer] ?? 0) + 1;
    by_phone[e.phone] = (by_phone[e.phone] ?? 0) + 1;
    by_calendar[e.calendar] = (by_calendar[e.calendar] ?? 0) + 1;
  }
  const referred = entries.filter(referredBy);

  return {
    total: entries.length,
    last_7_days: last7,
    previous_7_days: prev7,
    first_day: firstDay,
    by_day,
    by_source,
    hours,
    median_hours: median(entries.map((e) => e.hours_lost_per_week)),
    founding_members: entries.filter((e) => e.founding_member).length,
    referred: referred.length,
    referrers: new Set(referred.map((e) => e.referred_by)).size,
    by_role,
    by_computer,
    by_phone,
    by_calendar,
    excluded: all.length - entries.length,
  };
}
