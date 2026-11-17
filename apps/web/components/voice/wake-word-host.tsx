"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { meetingEndsAt, useMeetings } from "@/lib/meetings";
import { useOffTheRecord } from "@/lib/off-the-record";
import {
  emitWake,
  HOME_SCREEN_LINE,
  isWakeHeld,
  micBlockedLine,
  NO_RECOGNISER_LINE,
  setWakeArmed,
  setWakeHeard,
  setWakeSetting,
  subscribeWakeHold,
  useWakeHeld,
  useWakeSetting,
  type WakeSetting,
} from "@/lib/wake-word";
import { useConversation } from "./conversation";
import { earconContext, primeEarcons } from "./earcons";
import { isIosHomeScreenApp, markRefused, unlockAudio } from "./speech";
import { listenForWake } from "./wake-loop";

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
          setWakeSetting({ mode: "off" }, micBlockedLine(navigator.userAgent));
        } else if (mode === "local") {
          // Never fall back to the cloud on our own: the user agreed to on device listening.
          setWakeSetting({ mode: "off" }, LOCAL_GONE_COPY);
        } else {
          markRefused();
          setWakeSetting({ mode: "off" }, isIosHomeScreenApp() ? HOME_SCREEN_LINE : NO_RECOGNISER_LINE);
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
