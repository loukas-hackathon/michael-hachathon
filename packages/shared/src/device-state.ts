import { SETUP_KEY_NAMES } from "./schemas";

// One rule for a device connection (Apple Watch, Mac, iPhone), used by both the Connections rows on
// You (apps/web/lib/connections-status.ts, GET /live/connections) and Michael's chat context
// (apps/api/src/connections-state.ts), so the row and Michael can never disagree about the iPhone.

/** A device source that has sent nothing for this long needs attention (#307). */
export const DEVICE_QUIET_MS = 24 * 60 * 60_000;

/** The parts of a device key the rule reads (PersonalToken has them all). */
export interface DeviceKey {
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/** The iPhone shortcut's device key: the most recently used, then the newest; null when none. */
export function pickIphoneKey<T extends DeviceKey>(tokens: readonly T[] | null | undefined): T | null {
  return (
    (tokens ?? [])
      .filter((t) => t.name === SETUP_KEY_NAMES.iphone)
      .sort(
        (a, b) =>
          (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "") ||
          b.created_at.localeCompare(a.created_at),
      )
      .at(0) ?? null
  );
}

/**
 * sending: data in the last 24 hours. quiet: data, but older. tested: no data yet, but the device
 * key reached us (a hand run of the iPhone shortcut, #466), so it is connected. added: a key that
 * was never used. none: nothing at all. `at` is the last data, or the key's last use when tested.
 */
export type DeviceState =
  | { kind: "sending" | "quiet"; at: string }
  | { kind: "tested"; at: string }
  | { kind: "added" | "none"; at: null };

export function deviceState(
  lastEventAt: string | null | undefined,
  key: DeviceKey | null | undefined,
  now = Date.now(),
): DeviceState {
  if (lastEventAt)
    return { kind: now - Date.parse(lastEventAt) > DEVICE_QUIET_MS ? "quiet" : "sending", at: lastEventAt };
  if (key?.last_used_at) return { kind: "tested", at: key.last_used_at };
  return { kind: key ? "added" : "none", at: null };
}

/** Connected, as the row and Michael both count it. */
export const deviceConnected = (s: DeviceState) =>
  s.kind === "sending" || s.kind === "quiet" || s.kind === "tested";
