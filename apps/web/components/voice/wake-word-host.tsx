"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { meetingEndsAt, useMeetings } from "@/lib/meetings";
import { useOffTheRecord } from "@/lib/off-the-record";
import {
  emitWake,
  isFatalWakeError,
  isQuietWakeError,
  isWakeHeld,
  matchWake,
  restartDelay,
  SHORT_SESSION_MS,
  setWakeArmed,
  setWakeHeard,
  setWakeSetting,
  subscribeWakeHold,
  useWakeHeld,
  useWakeSetting,
  WAKE_SETTLE_MS,
  type Wake,
  type WakeSetting,
  wakeIn,
} from "@/lib/wake-word";
import { useConversation } from "./conversation";
import { earconContext, primeEarcons } from "./earcons";
import { isIosHomeScreenApp, markRefused, type Recognition, recognitionCtor, unlockAudio } from "./speech";

// The wake word's listening loop (lib/wake-word.ts has the matching and the rules). Mounted once in
// the root layout; Michael answers in the island (wake-island.tsx). While it listens, the Mi button
// wears a still ring (the privacy sign), gone in the same frame listening stops. It listens only while every one of these holds: the switch is on, the app is
// visible, not off the record, no meeting running, no conversation or push to talk in progress,
// and Michael is not speaking. Any of them changing stops the recogniser at once.
//
// Browser support (17 Nov 2026; checked against the specs and MDN, and in Chromium with a scripted
// recogniser in e2e/tests/wake-word.spec.ts, not yet on real devices):
// - Chrome on a laptop and Android: the full path. With an on device English pack (Chrome 139+,
//   SpeechRecognition.available/install), nothing leaves the device; otherwise Google's speech
//   service hears audio while it listens. Chrome ends each session after a pause or about a minute;
//   the loop starts the next one at once and backs off after errors.
// - Safari on iPhone and Mac (webkitSpeechRecognition): continuous listening is unreliable; sessions
//   end often (each restart can blink the microphone indicator) and some iOS versions stop after
//   the first phrase. It tries and backs off; Apple decides whether audio is processed on the
//   device. Not verified on a real iPhone in this change.
// - The iPhone Home Screen app: most iOS versions refuse speech recognition there
//   (service-not-allowed). The switch then says so and turns off.
// - Firefox: no recogniser, so the switch is hidden.

/** Screens where Michael already holds the microphone or there is no user yet. */
const HIDDEN_ON = ["/onboarding", "/connect", "/stage", "/setup", "/login", "/auth", "/join"];

const MIC_COPY = "I need the microphone to hear my name.";
const REFUSED_COPY = "This browser won't let me listen for my name.";
const HOME_SCREEN_COPY = "The Home Screen app can't listen for my name. Open me in Safari.";
const LOCAL_GONE_COPY = "On device listening stopped here. Switch on again to choose.";

export function WakeWordHost() {
  const setting = useWakeSetting();
  const pathname = usePathname();
  if (setting.mode === "off" || HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;
  return <WakeListener setting={setting} />;
}

function subscribeVisible(l: () => void) {
  document.addEventListener("visibilitychange", l);
  return () => document.removeEventListener("visibilitychange", l);
}

const useVisible = () =>
  useSyncExternalStore(
    subscribeVisible,
    () => document.visibilityState === "visible",
    () => false,
  );

function WakeListener({ setting }: { setting: Exclude<WakeSetting, { mode: "off" }> }) {
  const { on: offTheRecord } = useOffTheRecord();
  const meetings = useMeetings();
  const talk = useConversation();
  const held = useWakeHeld();
  const visible = useVisible();
  // Heard: the conversation is on its way (Chat may still be loading). Cleared once it starts.
  const [woken, setWoken] = useState(false);
  // The recogniser kept failing: rest until the app is opened again (or the switch flips).
  const [resting, setResting] = useState(false);
  const talking = talk.phase !== "off" && talk.phase !== "unavailable";
  const meeting = !!meetings?.active && meetingEndsAt(meetings.active) > Date.now();
  const listening = visible && !offTheRecord && !meeting && !talking && !held && !woken && !resting;

  useEffect(() => {
    if (!visible) setResting(false);
  }, [visible]);
  const { mode } = setting;
  const lang = setting.lang;

  useEffect(() => {
    if (talking) setWoken(false);
  }, [talking]);
  // If Chat never took the wake (it failed to load), listen again rather than stay deaf.
  useEffect(() => {
    if (!woken) return;
    const t = setTimeout(() => setWoken(false), 10_000);
    return () => clearTimeout(t);
  }, [woken]);

  // The armed ring on the Mi button follows listening exactly.
  useEffect(() => {
    setWakeArmed(listening);
    return () => setWakeArmed(false);
  }, [listening]);

  // iOS lets a page make sound only after a tap: the first tap anywhere unlocks his voice and the
  // earcons, so a wake later (with no tap) can be heard.
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      void earconContext()
        ?.resume()
        .catch(() => {});
      primeEarcons();
    };
    document.addEventListener("pointerup", unlock, { once: true, capture: true });
    return () => document.removeEventListener("pointerup", unlock, { capture: true });
  }, []);

  useEffect(() => {
    if (!listening) return;
    const stop = listenForWake({
      lang,
      local: mode === "local",
      onRest: () => setResting(true),
      onHeard: setWakeHeard,
      onWake: (w) => {
        setWoken(true);
        // The island takes it: haptic, earcon, bloom and the island in the same frame.
        emitWake(w);
      },
      onFatal: (code) => {
        if (code === "not-allowed" && !isIosHomeScreenApp()) {
          setWakeSetting({ mode: "off" }, MIC_COPY);
        } else if (mode === "local") {
          // Never fall back to the cloud on our own: the user agreed to on device listening.
          setWakeSetting({ mode: "off" }, LOCAL_GONE_COPY);
        } else {
          markRefused();
          setWakeSetting({ mode: "off" }, isIosHomeScreenApp() ? HOME_SCREEN_COPY : REFUSED_COPY);
        }
      },
    });
    // A hold (push to talk, his own voice) lets go of the microphone in the same tick.
    const unhold = subscribeWakeHold(() => {
      if (isWakeHeld()) stop();
    });
    return () => {
      unhold();
      stop();
      setWakeHeard(false);
    };
  }, [listening, lang, mode]);

  return null;
}

// ---------- the loop ----------

type LoopOptions = {
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
 * browser ends is followed by the next, at once after a normal end and with a growing pause after
 * errors or sessions that end straight away, up to MAX_FAILURES, then it rests until the app is
 * opened again. Returns the stop, which drops the recogniser without letting it act.
 */
export function listenForWake(opts: LoopOptions): () => void {
  let stopped = false;
  let failures = 0;
  let rec: Recognition | null = null;
  let restart: ReturnType<typeof setTimeout> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let candidate: string | null = null;

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

  const schedule = () => {
    const wait = restartDelay(failures);
    if (wait === null) {
      stopped = true;
      return opts.onRest();
    }
    restart = setTimeout(begin, wait);
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
    r.onresult = (e) => {
      heard = true;
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
      if (isQuietWakeError(e.error)) return;
      if (isFatalWakeError(e.error)) fatal = e.error;
      else errored = true;
    };
    r.onend = () => {
      if (rec !== r) return;
      rec = null;
      if (stopped) return;
      if (fatal) {
        stop();
        return opts.onFatal(fatal);
      }
      // Ended mid phrase, after the name: act on what was heard.
      if (candidate) return fire();
      const short = !heard && Date.now() - startedAt < SHORT_SESSION_MS;
      failures = errored || short ? failures + 1 : 0;
      schedule();
    };
    rec = r;
    try {
      r.start();
    } catch {
      rec = null;
      failures++;
      schedule();
    }
  }

  begin();
  return stop;
}
