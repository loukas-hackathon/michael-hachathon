import type { SourceSetting } from "@michael/shared";

// What a source's privacy switch shows (#512). The API reports a source with no saved rule as
// `enabled: false` with an epoch `updated_at`, yet ingest collects it (privacy.ts `decide`: no
// entry counts as allowed) and its first event saves the rule as on. So the switch reads the real
// collecting rule: a saved rule as saved, no rule as On. Location (maps) stays opt in: its
// coordinates are kept only once the user switches it on. Off the record is separate and wins
// over every switch; the switch keeps showing the source's own rule underneath it.

const EPOCH = new Date(0).getTime();

/** Sources whose data is kept only after an explicit yes, so no rule reads Off. */
const EXPLICIT_OPT_IN: ReadonlySet<SourceSetting["source"]> = new Set(["maps"]);

/** True when the user (or a first event) has saved a rule for this source. */
export function hasSavedRule(setting: SourceSetting): boolean {
  return Date.parse(setting.updated_at) !== EPOCH;
}

/** On or Off for the switch: the saved rule, or what ingest does with no rule. */
export function sourceSwitchOn(setting: SourceSetting | undefined): boolean {
  if (!setting) return false;
  if (hasSavedRule(setting)) return setting.enabled;
  return setting.enabled || !EXPLICIT_OPT_IN.has(setting.source);
}
