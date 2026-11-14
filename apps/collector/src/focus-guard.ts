import { execFile } from "node:child_process";
import type { FocusGuard, FocusGuardsResponse } from "@michael/shared";
import { findBlockableMacApp, isBlockableBundleId, isNeverBlocked } from "@michael/shared";

// Focus guards (#41): while one runs, a muted app that comes to the front is closed and the person
// sees why ("WhatsApp is off until 12:00. Back to Deep work."). Least invasive route that needs no
// admin rights and no Accessibility permission:
//   - which app is in front: `lsappinfo` (ships with macOS, needs no permission);
//   - closing it: AppleScript `quit` sent by bundle id, the same as Cmd+Q, so the app saves and
//     closes normally. macOS asks once per app "allow ... to control WhatsApp" (Automation). If the
//     person says no, it falls back to hiding the app (Cmd+H) through System Events;
//   - the notification: AppleScript `display notification`.
// Never closes anything off the allowlist (mac-apps.ts in @michael/shared), never the system, a
// terminal, Claude or Michael, and does nothing while the person is off the record.

/** Runs a command and resolves with its stdout. Injected so tests never touch the real Mac. */
export type Runner = (file: string, args: string[]) => Promise<string>;

export const runCommand: Runner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 5000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });

/** An AppleScript string literal: quotes and backslashes escaped, line breaks dropped. */
export const appleScriptString = (s: string) =>
  `"${s
    .replace(/[\r\n]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;

/** "12:00" on this Mac's clock, 24 hour. */
export const clockOf = (iso: string, timeZone?: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
    new Date(iso),
  );

/** "Instagram is off until 12:00. Back to The company." */
export function notificationText(
  app: string,
  guard: Pick<FocusGuard, "end_at" | "back_to">,
  timeZone?: string,
) {
  const back = guard.back_to?.trim();
  return `${app} is off until ${clockOf(guard.end_at, timeZone)}.${back ? ` Back to ${back.replace(/[.]+$/, "")}.` : ""}`;
}

/** The running guard that mutes this bundle id at `now`, or null. Checks the allowlist again. */
export function guardFor(guards: FocusGuard[], bundleId: string, now: number): FocusGuard | null {
  if (!bundleId || isNeverBlocked(bundleId) || !isBlockableBundleId(bundleId)) return null;
  const id = bundleId.toLowerCase();
  return (
    guards.find(
      (g) =>
        Date.parse(g.start_at) <= now &&
        now < Date.parse(g.end_at) &&
        g.bundle_ids.some((b) => b.toLowerCase() === id),
    ) ?? null
  );
}

/** Parses `lsappinfo info -only bundleid <asn>` output: "CFBundleIdentifier"="net.whatsapp.WhatsApp". */
export function parseBundleId(out: string): string | null {
  const m = /"CFBundleIdentifier"\s*=\s*"([^"]+)"/.exec(out);
  return m?.[1] ?? null;
}

/** The bundle id of the app in front, or null when it cannot be told. */
export async function frontmostBundleId(run: Runner): Promise<string | null> {
  try {
    const asn = (await run("lsappinfo", ["front"])).trim();
    if (!asn) return null;
    return parseBundleId(await run("lsappinfo", ["info", "-only", "bundleid", asn]));
  } catch {
    return null;
  }
}

/** Closes the app gracefully (quit, like Cmd+Q); hides it if macOS does not allow the quit. */
export async function closeApp(run: Runner, bundleId: string): Promise<"quit" | "hidden" | "failed"> {
  // The last guard before acting: nothing off the allowlist, ever.
  if (isNeverBlocked(bundleId) || !isBlockableBundleId(bundleId)) return "failed";
  const id = appleScriptString(bundleId);
  try {
    await run("osascript", ["-e", `tell application id ${id} to quit`]);
    return "quit";
  } catch {
    try {
      await run("osascript", [
        "-e",
        `tell application "System Events" to set visible of (first application process whose bundle identifier is ${id}) to false`,
      ]);
      return "hidden";
    } catch {
      return "failed";
    }
  }
}

export async function notify(run: Runner, text: string): Promise<void> {
  try {
    await run("osascript", ["-e", `display notification ${appleScriptString(text)} with title "Michael"`]);
  } catch {
    // A missing notification must never stop the guard.
  }
}

export interface GuardianOptions {
  apiUrl: string;
  apiKey: string;
  run?: Runner;
  fetch?: typeof fetch;
  log?: (message: string) => void;
  now?: () => number;
  timeZone?: string;
}

const NOTIFY_EVERY_MS = 60_000;

/**
 * Keeps the guards fresh (`refresh`, every 30 to 60 s) and enforces them (`tick`, every few
 * seconds while one runs). Holds no state that matters: a restart picks the guards up again.
 */
export class FocusGuardian {
  private guards: FocusGuard[] = [];
  private offTheRecord = false;
  private lastNotice = new Map<string, number>();
  private readonly run: Runner;
  private readonly fetchFn: typeof fetch;
  private readonly log: (message: string) => void;
  private readonly now: () => number;

  constructor(private readonly opts: GuardianOptions) {
    this.run = opts.run ?? runCommand;
    this.fetchFn = opts.fetch ?? fetch;
    this.log = opts.log ?? ((m) => console.log(`[focus-guard] ${m}`));
    this.now = opts.now ?? Date.now;
  }

  /** Reads the running guards. On any failure it keeps the last good list (until it ends). */
  async refresh(): Promise<void> {
    try {
      const res = await this.fetchFn(`${this.opts.apiUrl}/v1/focus-guards/active`, {
        headers: { authorization: `Bearer ${this.opts.apiKey}` },
      });
      if (!res.ok) {
        this.log(`could not read guards: API answered ${res.status}`);
        return;
      }
      const body = (await res.json()) as FocusGuardsResponse;
      this.offTheRecord = body.off_the_record === true;
      this.guards = this.offTheRecord ? [] : Array.isArray(body.guards) ? body.guards : [];
    } catch (error) {
      this.log(`could not read guards: ${(error as Error).message}`);
    }
  }

  /** True while a guard is running (the caller checks the front app more often then). */
  active(): boolean {
    const now = this.now();
    return (
      !this.offTheRecord &&
      this.guards.some((g) => Date.parse(g.start_at) <= now && now < Date.parse(g.end_at))
    );
  }

  /** One check: if a muted app is in front, close it and say why. Returns what it did. */
  async tick(): Promise<{ bundleId: string; result: "quit" | "hidden" | "failed" } | null> {
    if (!this.active()) return null;
    const bundleId = await frontmostBundleId(this.run);
    if (!bundleId) return null;
    const now = this.now();
    const guard = guardFor(this.guards, bundleId, now);
    if (!guard) return null;
    const name =
      findBlockableMacApp(bundleId)?.name ??
      guard.apps.find((a) => findBlockableMacApp(a)?.bundle_ids.includes(bundleId)) ??
      "That app";
    const result = await closeApp(this.run, bundleId);
    this.log(`${name} came to the front: ${result}`);
    const key = `${guard.id}|${bundleId}`;
    if (result !== "failed" && now - (this.lastNotice.get(key) ?? 0) >= NOTIFY_EVERY_MS) {
      this.lastNotice.set(key, now);
      await notify(this.run, notificationText(name, guard, this.opts.timeZone));
    }
    return { bundleId, result };
  }
}

/** Runs the guardian until the process stops: guards every `refreshSeconds`, the front app every 5 s. */
export function startFocusGuardian(opts: GuardianOptions & { refreshSeconds?: number }): () => void {
  const guardian = new FocusGuardian(opts);
  const refreshMs = Math.min(60, Math.max(30, opts.refreshSeconds ?? 45)) * 1000;
  void guardian.refresh();
  const a = setInterval(() => void guardian.refresh(), refreshMs);
  let busy = false;
  const b = setInterval(() => {
    if (busy) return;
    busy = true;
    guardian
      .tick()
      .catch(() => null)
      .finally(() => {
        busy = false;
      });
  }, 5000);
  return () => {
    clearInterval(a);
    clearInterval(b);
  };
}
