import type { Event, PatternReport } from "@michael/shared";
import { aiToolUse } from "./ai";
import { macAppCadence, phoneCadence } from "./cadence";
import { buildContext, type PatternOptions } from "./context";
import { analyseFocus, drift, focusDisruptions, recoveryCost, repeatOffenders } from "./focus";
import { type Detectors, headlinesOf } from "./headlines";
import { lateScreens } from "./late";
import { contextSwitching } from "./switching";
import { timeByApp } from "./totals";
import { iso } from "./util";

export type { PatternOptions } from "./context";
export { DEFAULT_TIMEZONE, RULES } from "./context";
export { isHeadline, NO_HEADLINES } from "./headlines";

/**
 * Events in, patterns out. Pure: no I/O and no clock, so the same input always gives the same
 * report. Pass every event that overlaps the range (a few hours more on each side helps: sleep
 * and recovery just outside the range are used for bedtime and the morning after).
 */
export function buildPatternReport(events: Event[], options: PatternOptions): PatternReport {
  const ctx = buildContext(events, options);
  const focus = analyseFocus(ctx);

  const detectors: Detectors = {
    phone_cadence: phoneCadence(ctx),
    mac_app_cadence: macAppCadence(ctx),
    focus_disruptions: focusDisruptions(ctx, focus),
    recovery_cost: recoveryCost(ctx, focus),
    repeat_offenders: repeatOffenders(ctx, focus),
    drift: drift(ctx, focus),
    late_screens: lateScreens(ctx),
    context_switching: contextSwitching(ctx),
    time_by_app: timeByApp(ctx),
    ai_tool_use: aiToolUse(ctx),
  };

  return {
    from: iso(ctx.from),
    to: iso(ctx.to),
    timezone: ctx.zone.name,
    generated_at: iso(ctx.now),
    days: ctx.days.map((d) => ({ day: d.day, complete: d.complete })),
    inputs: {
      mac_app_usage: ctx.tl.counts.macAppUsage,
      iphone_app_usage: ctx.tl.counts.iphoneAppUsage,
      app_usage_superseded: ctx.tl.counts.appUsageSuperseded,
      web_visits: ctx.tl.counts.webVisits,
      web_visits_superseded: ctx.tl.counts.webVisitsSuperseded,
      web_visits_unmeasured: ctx.tl.counts.webVisitsUnmeasured,
      searches: ctx.tl.counts.searches,
      goal_blocks: focus.blocks.length,
      sleeps: ctx.sleeps.length,
      ai_sessions: detectors.ai_tool_use.data?.sessions ?? 0,
    },
    // Order of importance: the headline first. Trivial findings and small samples stay out.
    headlines: headlinesOf(detectors),
    ...detectors,
  };
}
