import { z } from "zod";
import { IsoDateTime, LocalDay } from "./schemas";

// GET /v1/admin/traction: the founders' traction numbers for investors (docs/api.md, Traction).
// Admins only. Only counts and aggregates across real users: never one user's events, name or email.
// Weeks run Monday to Sunday in `timezone`; shares are 0..1, null when there is nothing to divide by.

const Count = z.number().int().nonnegative();
const Share = z.number().min(0).max(1).nullable();
const Minutes = z.number().int().nonnegative();

export const TractionWeek = z.object({
  // Monday of the week.
  week_start: LocalDay,
  sign_ups: Count,
  // Real users active on at least one day of the week.
  active: Count,
});
export type TractionWeek = z.infer<typeof TractionWeek>;

// Share of one sign up cohort active in the Nth calendar week after its sign up week.
// Null until that week has begun; `complete` is false while it is still running.
export const TractionRetentionCell = z.object({
  week: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  share: Share,
  active: Count,
  complete: z.boolean(),
});
export type TractionRetentionCell = z.infer<typeof TractionRetentionCell>;

export const TractionCohort = z.object({
  week_start: LocalDay,
  sign_ups: Count,
  retention: z.array(TractionRetentionCell),
});
export type TractionCohort = z.infer<typeof TractionCohort>;

export const TractionGoalWeek = z.object({
  // Monday of the week.
  week_start: LocalDay,
  // Active users with planned goal time that week (the ones summed below).
  users: Count,
  // Goal time booked for the whole week.
  planned_minutes: Minutes,
  // Of it, the time that has already passed (all of it for a past week).
  elapsed_minutes: Minutes,
  spent_minutes: Minutes,
  // spent / elapsed over those users, 0..1: the headline score, summed across users.
  share: Share,
  // The score's time won back (less lost inside planned blocks than the user's usual week).
  won_back_minutes: Minutes,
});
export type TractionGoalWeek = z.infer<typeof TractionGoalWeek>;

export const Traction = z.object({
  generated_at: IsoDateTime,
  timezone: z.string(),
  // Accounts left out of every number: the demo account (which demo visitors and the judges'
  // copies use) and the reserved demo and judges addresses. A count only.
  excluded_accounts: Count,
  sign_ups: z.object({
    total: Count,
    // The last 8 weeks, oldest first; the last one is this week, so far.
    weeks: z.array(TractionWeek),
  }),
  activation: z.object({
    // Sign ups that connected at least one real source.
    activated: Count,
    share: Share,
    // Median minutes from sign up to the first source, over activated users.
    median_minutes_to_first_source: z.number().nonnegative().nullable(),
  }),
  active: z.object({
    // Active today.
    daily: Count,
    // Mean of the daily count over the last 7 days, one decimal.
    daily_average_7d: z.number().nonnegative(),
    // Active on any of the last 7 days.
    weekly: Count,
    // What "active" means, in words.
    rule: z.string(),
  }),
  retention: z.object({
    // Up to the last 8 sign up weeks, oldest first.
    cohorts: z.array(TractionCohort),
    // Over every cohort whose week N has begun, weighted by cohort size.
    week_1: Share,
    week_2: Share,
    week_4: Share,
  }),
  goal_time: z.object({
    this_week: TractionGoalWeek,
    last_week: TractionGoalWeek,
    // Users scored (active in either week), and whether the list was capped for cost.
    users_scored: Count,
    capped: z.boolean(),
  }),
  // All time totals across real users.
  engagement: z.object({
    // Recommendations Michael carried out (done, including those later undone).
    actions_done: Count,
    // Of those, undone by the user.
    actions_undone: Count,
    // Lines the users typed or said to Michael in chat.
    chat_messages: Count,
    // Nudges delivered (watch, push, Telegram).
    nudges_sent: Count,
    // Tool calls from connected AI agents (the claude.ai connector among them).
    connector_queries: Count,
  }),
});
export type Traction = z.infer<typeof Traction>;
