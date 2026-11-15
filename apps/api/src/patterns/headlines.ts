import type {
  AiToolUse,
  ContextSwitching,
  Drift,
  FocusDisruptions,
  LateScreens,
  MacAppCadence,
  PhoneCadence,
  RecoveryCost,
  RepeatOffenders,
  TimeByApp,
} from "@michael/shared";
import { RULES } from "./context";
import type { Detector } from "./detector";

// Which summaries are worth a headline. A detector can have enough data to answer and still have
// nothing to say: "0 minutes lost", a pattern drawn from a handful of events, a quiet night. Those
// keep their data and their summary (the detail and the analysis still see them) but stay out of
// `headlines`, which is what Michael leads with in chat, in the brief and through the connector.
// When no detector clears its bar the report has no headlines and the readers say
// "Not enough data yet".

export interface Detectors {
  phone_cadence: Detector<PhoneCadence>;
  mac_app_cadence: Detector<MacAppCadence>;
  focus_disruptions: Detector<FocusDisruptions>;
  recovery_cost: Detector<RecoveryCost>;
  repeat_offenders: Detector<RepeatOffenders>;
  drift: Detector<Drift>;
  late_screens: Detector<LateScreens>;
  context_switching: Detector<ContextSwitching>;
  time_by_app: Detector<TimeByApp>;
  ai_tool_use: Detector<AiToolUse>;
}

const H = RULES.headline;

/** Each detector's bar, given its data. True means the summary is a headline. */
const WORTH: { [K in keyof Detectors]: (data: NonNullable<Detectors[K]["data"]>) => boolean } = {
  phone_cadence: (d) => d.sessions >= H.minSessions,
  // With no distracting app frequent enough there is no pattern to name.
  mac_app_cadence: (d) => d.apps.length > 0,
  focus_disruptions: (d) =>
    d.focus_minutes >= H.minFocusMinutes &&
    d.disruptions >= H.minDisruptions &&
    d.minutes_lost >= H.minMinutes,
  recovery_cost: (d) => d.measured >= H.minRecoverySample && d.minutes_until_back_per_day >= H.minMinutes,
  repeat_offenders: (d) => {
    const top = d.offenders[0];
    return top !== undefined && (top.disruptions >= H.minDisruptions || top.minutes_lost >= H.minMinutes);
  },
  drift: (d) => d.minutes >= H.minMinutes,
  late_screens: (d) => d.late_nights > 0,
  context_switching: (d) => d.active_minutes >= H.minScreenMinutes,
  time_by_app: (d) => d.totals.active_seconds >= H.minScreenMinutes * 60,
  ai_tool_use: (d) => d.sessions >= H.minAiSessions && d.wall_minutes >= H.minMinutes,
};

/** True when the detector answered and what it found is big enough to lead with. */
export function isHeadline<K extends keyof Detectors>(name: K, detector: Detectors[K]): boolean {
  if (detector.status !== "ok" || !detector.summary || detector.data === null) return false;
  return WORTH[name](detector.data as NonNullable<Detectors[K]["data"]>);
}

/** The headlines of a report, most important first (the order of `detectors`). */
export function headlinesOf(detectors: Detectors): string[] {
  const out: string[] = [];
  for (const name of Object.keys(detectors) as (keyof Detectors)[]) {
    const d = detectors[name];
    if (d.summary && isHeadline(name, d)) out.push(d.summary);
  }
  return out;
}

/** What a reader says when a report has no headline. */
export const NO_HEADLINES = "Not enough data yet";
