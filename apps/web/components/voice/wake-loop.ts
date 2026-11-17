// The wake word's listening loop, without React (tested alone in wake-loop.test.ts). The host
// (wake-word-host.tsx) decides when it runs; lib/wake-word.ts has the matching and the rules.

import {
  isFatalWakeError,
  isQuietWakeError,
  type LoopCount,
  matchWake,
  nextRestart,
  noteWakeDebug,
  readWakeDebug,
  SHORT_SESSION_MS,
  WAKE_SETTLE_MS,
  type Wake,
  wakeIn,
} from "../../lib/wake-word";
import { type Recognition, recognitionCtor } from "./speech";

export type LoopOptions = {
  lang: string;
  /** On device only (Chrome's processLocally): audio never leaves the device. */
  local: boolean;
  onWake: (w: Wake) => void;
  /** The name is in an unfinished phrase (true), or that candidate is gone (false). */
  onHeard?: (on: boolean) => void;
  /** Listening cannot run here (microphone refused, no recogniser, no language pack). */
  onFatal: (code: string) => void;
  /** Too many failures in a row: the loop has stopped trying. */
  onRest: () => void;
};

/**
 * Listens for the name until stopped, woken or refused. One recogniser at a time; each one the
 * browser ends is followed by the next within RESTART_MS (100ms) after a normal end, and with a
 * growing pause after errors or a long run of sessions that end straight away, up to MAX_FAILURES,
 * then it rests until the app is opened again. A session that ends with the name in an unfinished
 * phrase acts on it, so a wake is never lost to the browser's own restart. Returns the stop, which
 * drops the recogniser without letting it act.
 */
export function listenForWake(opts: LoopOptions): () => void {
  let stopped = false;
  let count: LoopCount = { failures: 0, quick: 0 };
  let rec: Recognition | null = null;
  let restart: ReturnType<typeof setTimeout> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let candidate: string | null = null;
  let endedAt = 0;

  const drop = () => {
    const r = rec;
    rec = null;
    if (!r) return;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try {
      r.abort();
    } catch {
      // Already stopped.
    }
  };

  const stop = () => {
    stopped = true;
    clearTimeout(restart);
    clearTimeout(settle);
    if (candidate) opts.onHeard?.(false);
    drop();
  };

  const fire = () => {
    clearTimeout(settle);
    const w = candidate ? matchWake(candidate) : null;
    candidate = null;
    if (!w || stopped) {
      opts.onHeard?.(false);
      return;
    }
    stop();
    opts.onWake(w);
  };

  const schedule = (end: { errored: boolean; short: boolean }) => {
    const next = nextRestart(count, end);
    count = { failures: next.failures, quick: next.quick };
    if (next.delay === null) {
      stopped = true;
      return opts.onRest();
    }
    restart = setTimeout(begin, next.delay);
  };

  function begin() {
    if (stopped) return;
    const Ctor = recognitionCtor();
    if (!Ctor) {
      stop();
      return opts.onFatal("service-not-allowed");
    }
    const r = new Ctor() as Recognition & { processLocally?: boolean };
    r.lang = opts.lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    if (opts.local) r.processLocally = true;
    const startedAt = Date.now();
    let heard = false;
    let errored = false;
    let fatal: string | null = null;
    let code = "end";
    r.onresult = (e) => {
      heard = true;
      const last = e.results[e.results.length - 1]?.[0]?.transcript?.trim();
      if (last) noteWakeDebug({ heard: last, heardAt: Date.now() });
      const hit = wakeIn(e);
      if (!hit) return;
      // The name is in: wait for the rest of the sentence, or act now if the phrase is finished.
      // Two stages: a quiet, dim island now, the full wake once the phrase is settled.
      if (!candidate && !hit.final) opts.onHeard?.(true);
      candidate = hit.phrase;
      clearTimeout(settle);
      if (hit.final) fire();
      else settle = setTimeout(fire, WAKE_SETTLE_MS);
    };
    r.onerror = (e) => {
      code = e.error;
      if (isQuietWakeError(e.error)) return;
      if (isFatalWakeError(e.error)) fatal = e.error;
      else errored = true;
    };
    r.onend = () => {
      if (rec !== r) return;
      rec = null;
      endedAt = Date.now();
      noteWakeDebug({ lastEnd: code });
      if (stopped) return;
      if (fatal) {
        stop();
        return opts.onFatal(fatal);
      }
      // Ended mid phrase, after the name: act on what was heard.
      if (candidate) return fire();
      const short = !heard && Date.now() - startedAt < SHORT_SESSION_MS;
      schedule({ errored, short });
    };
    rec = r;
    try {
      r.start();
      noteWakeDebug({
        sessions: readWakeDebug().sessions + 1,
        gapMs: endedAt ? Date.now() - endedAt : null,
      });
    } catch {
      rec = null;
      schedule({ errored: true, short: false });
    }
  }

  begin();
  return stop;
}
