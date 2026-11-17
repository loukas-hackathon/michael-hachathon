import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FOCUS_SHORTCUT_NAME,
  FOCUS_SHORTCUT_OFF,
  type FocusGuardsResponse,
  focusShortcutInput,
} from "@michael/shared";
import type { Runner } from "./focus-guard";

// Do Not Disturb, asked then done (#447). The user taps the nudge's button; the API answers this
// Mac's next look with what to switch on and until when; this file runs the signed Michael Focus
// shortcut (scripts/shortcut/build.mjs, one Set Focus action) through macOS' own `shortcuts`
// command. No app may set a Focus directly, and this route needs no Accessibility permission.
// Focus is shared across the person's devices by default, so the iPhone follows the Mac.
//
// It never switches anything on by itself: only what the API says the user asked for. It switches
// off only what it switched on (an undo in Michael), and only before that would have ended anyway.
// Without the shortcut it does nothing and says so to the API, which then offers the install.

/**
 * How long one run may take. Proved on macOS 26.6 (15 Nov 2026): the Set Focus action takes effect
 * within two seconds, but while macOS has a Privacy question about the shortcut open on screen the
 * `shortcuts` command does not return, and the question goes away when the command is stopped. So
 * the command gets a minute, which is also the time the person has to answer the question.
 */
export const RUN_TIMEOUT_MS = 60_000;

const runShortcutsCommand: Runner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: RUN_TIMEOUT_MS }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });

/** True when `shortcuts list` names the shortcut on a line of its own. */
export const listsShortcut = (out: string, name = FOCUS_SHORTCUT_NAME) =>
  out.split("\n").some((line) => line.trim() === name);

/** A run that was stopped by the timeout (execFile marks it), not one that failed by itself. */
const timedOut = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { killed?: boolean }).killed === true;

/**
 * Runs the shortcut with `text` as its input. The CLI takes input as a file, so one is written.
 * `done`: the command returned. `waiting`: it was still waiting on macOS after a minute (a Privacy
 * question on screen); what it was asked to do has been sent, and by then has taken effect.
 * Anything else (no such shortcut, a refusal) throws.
 */
export async function runFocusShortcut(run: Runner, text: string): Promise<"done" | "waiting"> {
  const dir = mkdtempSync(join(tmpdir(), "michael-focus-"));
  try {
    const file = join(dir, "input.txt");
    writeFileSync(file, text);
    await run("shortcuts", ["run", FOCUS_SHORTCUT_NAME, "--input-path", file]);
    return "done";
  } catch (error) {
    if (timedOut(error)) return "waiting";
    throw error;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface DndKeeperOptions {
  apiUrl: string;
  apiKey: string;
  run?: Runner;
  fetch?: typeof fetch;
  log?: (message: string) => void;
  now?: () => number;
  /** This Mac's time zone, for the wall clock time the shortcut reads. Default: the system's. */
  timeZone?: string;
}

export type DndResult = "on" | "off" | "ended" | "missing" | "failed" | "nothing";

/** How long a "the shortcut is there" answer is trusted; "not there" is asked again every look. */
const SHORTCUT_TRUST_MS = 5 * 60_000;

export class DndKeeper {
  private applied: { id: string; until: string } | null = null;
  private shortcutAt = Number.NEGATIVE_INFINITY;
  private readonly run: Runner;
  private readonly fetchFn: typeof fetch;
  private readonly log: (message: string) => void;
  private readonly now: () => number;

  constructor(private readonly opts: DndKeeperOptions) {
    this.run = opts.run ?? runShortcutsCommand;
    this.fetchFn = opts.fetch ?? fetch;
    this.log = opts.log ?? ((m) => console.log(`[dnd] ${m}`));
    this.now = opts.now ?? Date.now;
  }

  /** Whether the Michael Focus shortcut is installed on this Mac. */
  async hasShortcut(): Promise<boolean> {
    if (this.now() - this.shortcutAt < SHORTCUT_TRUST_MS) return true;
    try {
      if (listsShortcut(await this.run("shortcuts", ["list"]))) {
        this.shortcutAt = this.now();
        return true;
      }
    } catch {
      // No `shortcuts` command, or it failed: the same as not installed.
    }
    return false;
  }

  /** One look: tells the API whether the shortcut is there, and does what the user asked for. */
  async tick(): Promise<DndResult> {
    const ready = await this.hasShortcut();
    let body: FocusGuardsResponse;
    try {
      const res = await this.fetchFn(
        `${this.opts.apiUrl}/v1/focus-guards/active?dnd=${ready ? "ready" : "missing"}`,
        { headers: { authorization: `Bearer ${this.opts.apiKey}` } },
      );
      if (!res.ok) return "nothing";
      body = (await res.json()) as FocusGuardsResponse;
    } catch {
      // The API is away: leave things as they are. What is on ends by itself.
      return "nothing";
    }
    const now = this.now();
    const want = body.dnd && Date.parse(body.dnd.until) > now ? body.dnd : null;
    if (this.applied && Date.parse(this.applied.until) <= now) {
      // It ended by itself, on time.
      this.applied = null;
      if (!want) return "ended";
    }
    if (want && this.applied?.id !== want.id) {
      if (!ready) return "missing";
      const input = focusShortcutInput(want.until, this.timeZone());
      try {
        this.say(await runFocusShortcut(this.run, input), `Do Not Disturb is on until ${input.slice(11)}`);
      } catch (error) {
        this.log(`could not switch it on: ${(error as Error).message}`);
        return "failed";
      }
      // Once per request, also when macOS was still asking: running it again would only ask again.
      this.applied = { id: want.id, until: want.until };
      return "on";
    }
    if (!want && this.applied) {
      // The user ended it in Michael before its time: switch off what this Mac switched on.
      try {
        this.say(
          await runFocusShortcut(this.run, FOCUS_SHORTCUT_OFF),
          "Do Not Disturb is off (ended in Michael)",
        );
      } catch (error) {
        this.log(`could not switch it off: ${(error as Error).message}`);
        return "failed";
      }
      this.applied = null;
      return "off";
    }
    return "nothing";
  }

  /** One line for the log, with what to do when macOS was still asking its question. */
  private say(outcome: "done" | "waiting", line: string): void {
    this.log(
      outcome === "done"
        ? line
        : `${line}. macOS is asking a Privacy question about the Michael Focus shortcut: choose Always Allow, once.`,
    );
  }

  private timeZone(): string {
    return this.opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

/** Looks every `seconds` (default 15) until the process stops. */
export function startDndKeeper(opts: DndKeeperOptions & { seconds?: number }): () => void {
  const keeper = new DndKeeper(opts);
  let busy = false;
  const look = () => {
    if (busy) return;
    busy = true;
    keeper
      .tick()
      .catch(() => null)
      .finally(() => {
        busy = false;
      });
  };
  look();
  const timer = setInterval(look, Math.max(5, opts.seconds ?? 15) * 1000);
  return () => clearInterval(timer);
}
