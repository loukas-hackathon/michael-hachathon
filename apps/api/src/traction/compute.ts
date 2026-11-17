import type {
  Traction,
  TractionCohort,
  TractionGoalWeek,
  TractionRetentionCell,
  WaitlistEntry,
} from "@michael/shared";
import { Zone } from "../patterns/time";
import { mondayOf } from "../score/score";
import type { AccountRow, TractionUserFacts } from "../store";
import { waitingList } from "./waiting-list";

// The traction numbers (GET /v1/admin/traction), as pure maths over rows the loader read
// (traction/index.ts). Every output is a count, a sum or a share: nothing per user leaves here.

export const WEEKS = 8;
export const RETENTION_WEEKS = [1, 2, 4] as const;
export const ACTIVE_RULE =
  "Active on a day: a source sent data that day, or the user wrote to Michael in chat. Opening the app is not logged.";

export interface TractionInput {
  now: number;
  timezone: string;
  /** Real accounts only (demo and judges' accounts already left out). */
  accounts: AccountRow[];
  excluded: number;
  facts: TractionUserFacts[];
  connectorQueries: number;
  goalTime: Traction["goal_time"];
  /** Every waiting list entry (our own addresses are left out in waitingList). */
  waitlist?: WaitlistEntry[];
}

/** The Monday of every week in the window, oldest first, ending with this week's. */
export function weekStarts(now: number, timezone: string, weeks = WEEKS): string[] {
  const zone = new Zone(timezone);
  const thisMonday = mondayOf(zone.dayOf(now), zone);
  return Array.from({ length: weeks }, (_, i) => zone.nextDay(thisMonday, -7 * (weeks - 1 - i)));
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function computeTraction(input: TractionInput): Traction {
  const zone = new Zone(input.timezone);
  const today = zone.dayOf(input.now);
  const mondays = weekStarts(input.now, input.timezone);
  const thisMonday = mondays[mondays.length - 1] as string;
  const weekOf = (day: string) => mondayOf(day, zone);
  const signUpWeek = new Map(input.accounts.map((a) => [a.id, weekOf(zone.dayOf(Date.parse(a.created_at)))]));
  const real = new Set(input.accounts.map((a) => a.id));
  const facts = input.facts.filter((f) => real.has(f.user_id));
  const byUser = new Map(facts.map((f) => [f.user_id, f]));

  // Active weeks per user (the Monday of each week with an active day).
  const activeWeeks = new Map(facts.map((f) => [f.user_id, new Set(f.active_days.map(weekOf))]));
  const activeIn = (user: string, monday: string) => activeWeeks.get(user)?.has(monday) ?? false;

  const weeks = mondays.map((monday) => ({
    week_start: monday,
    sign_ups: input.accounts.filter((a) => signUpWeek.get(a.id) === monday).length,
    active: facts.filter((f) => activeIn(f.user_id, monday)).length,
  }));

  // Activation: a real source connected at least once.
  const toFirst: number[] = [];
  for (const a of input.accounts) {
    const first = byUser.get(a.id)?.first_source_at;
    if (first) toFirst.push(Math.max(0, (Date.parse(first) - Date.parse(a.created_at)) / 60_000));
  }
  const medianMinutes = median(toFirst);

  // Active users: today, the mean of the last 7 days, and anyone in the last 7 days.
  const last7 = Array.from({ length: 7 }, (_, i) => zone.nextDay(today, -i));
  const daily = (day: string) => facts.filter((f) => f.active_days.includes(day)).length;
  const last7Set = new Set(last7);
  const weekly = facts.filter((f) => f.active_days.some((d) => last7Set.has(d))).length;

  // Retention: each sign up week's cohort, active in the 1st, 2nd and 4th calendar week after it.
  const cohorts: TractionCohort[] = [];
  const totals = new Map<number, { active: number; size: number }>();
  for (const monday of mondays) {
    const members = input.accounts.filter((a) => signUpWeek.get(a.id) === monday).map((a) => a.id);
    if (members.length === 0) continue;
    const retention: TractionRetentionCell[] = RETENTION_WEEKS.map((n) => {
      const target = zone.nextDay(monday, 7 * n);
      if (target > thisMonday) return { week: n, share: null, active: 0, complete: false };
      const active = members.filter((u) => activeIn(u, target)).length;
      const complete = target < thisMonday;
      if (complete) {
        const t = totals.get(n) ?? { active: 0, size: 0 };
        totals.set(n, { active: t.active + active, size: t.size + members.length });
      }
      return { week: n, share: active / members.length, active, complete };
    });
    cohorts.push({ week_start: monday, sign_ups: members.length, retention });
  }
  const retained = (n: number) => {
    const t = totals.get(n);
    return t ? ratio(t.active, t.size) : null;
  };

  const sum = (pick: (f: TractionUserFacts) => number) => facts.reduce((s, f) => s + pick(f), 0);
  const activated = toFirst.length;

  return {
    generated_at: new Date(input.now).toISOString(),
    timezone: input.timezone,
    excluded_accounts: input.excluded,
    sign_ups: { total: input.accounts.length, weeks },
    activation: {
      activated,
      share: ratio(activated, input.accounts.length),
      median_minutes_to_first_source: medianMinutes === null ? null : Math.round(medianMinutes),
    },
    active: {
      daily: daily(today),
      daily_average_7d: Math.round((last7.reduce((s, d) => s + daily(d), 0) / 7) * 10) / 10,
      weekly,
      rule: ACTIVE_RULE,
    },
    retention: { cohorts, week_1: retained(1), week_2: retained(2), week_4: retained(4) },
    goal_time: input.goalTime,
    waiting_list: waitingList(input.waitlist ?? [], { now: input.now, timezone: input.timezone }),
    engagement: {
      actions_done: sum((f) => f.actions_done),
      actions_undone: sum((f) => f.actions_undone),
      chat_messages: sum((f) => f.chat_messages),
      nudges_sent: sum((f) => f.nudges_sent),
      connector_queries: input.connectorQueries,
    },
  };
}

/** One week's goal time, summed over the users scored. */
export function sumGoalWeek(
  weekStart: string,
  scores: {
    planned_minutes: number;
    elapsed_minutes: number;
    spent_minutes: number;
    time_won_back_minutes: number;
  }[],
): TractionGoalWeek {
  const withPlan = scores.filter((s) => s.planned_minutes > 0);
  const total = (k: "planned_minutes" | "elapsed_minutes" | "spent_minutes" | "time_won_back_minutes") =>
    withPlan.reduce((s, x) => s + Math.round(x[k]), 0);
  const elapsed = total("elapsed_minutes");
  const spent = total("spent_minutes");
  return {
    week_start: weekStart,
    users: withPlan.length,
    planned_minutes: total("planned_minutes"),
    elapsed_minutes: elapsed,
    spent_minutes: spent,
    share: elapsed > 0 ? Math.min(1, spent / elapsed) : null,
    won_back_minutes: total("time_won_back_minutes"),
  };
}
