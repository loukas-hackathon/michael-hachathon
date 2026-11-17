"use client";

import { useEffect, useState } from "react";
import { setWakeSetting, type WakeEnv, type WakeSupport, wakeSupport } from "@/lib/wake-word";
import { primeEarcons } from "./earcons";
import { hasOnDeviceApi, prepareOnDevice } from "./on-device";
import { isIosHomeScreenApp, readRefused, recognitionCtor, subscribeRefused, unlockAudio } from "./speech";

// Turning "Yo Michael" on, shared by the You switch and Michael's offer (wake-offer.tsx), and what
// this device allows, so both say the same thing in the same words.

export const LOCAL_LINE = "Heard on this device, only while the app is open.";
export const MAYBE_LOCAL_LINE = "On this device where Chrome can, else its speech service hears it.";
export const CLOUD_LINE = "Your browser's speech service hears what is said while I listen.";
export const NO_LOCAL =
  "I couldn't get on device listening. Switch on again to use the browser's speech service.";

type Mic = WakeEnv["mic"];

/** The microphone permission, where the browser can say without asking. */
async function micPermission(): Promise<{ state: Mic; status: PermissionStatus | null }> {
  try {
    const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    if (!status) return { state: "unknown", status: null };
    const s = status.state;
    return { state: s === "granted" || s === "denied" || s === "prompt" ? s : "unknown", status };
  } catch {
    return { state: "unknown", status: null };
  }
}

/** What this device allows now: null until the browser has said (never on the server). */
export function useWakeSupport(): WakeSupport | null {
  const [support, setSupport] = useState<WakeSupport | null>(null);
  useEffect(() => {
    let alive = true;
    let status: PermissionStatus | null = null;
    let mic: Mic = "unknown";
    const update = () => {
      if (!alive) return;
      setSupport(
        wakeSupport({
          recognition: recognitionCtor() !== null,
          refused: readRefused(),
          iosHomeScreen: isIosHomeScreenApp(),
          mic,
        }),
      );
    };
    const onChange = () => {
      mic = status ? ((status.state as Mic) ?? "unknown") : mic;
      update();
    };
    update();
    void micPermission().then((p) => {
      mic = p.state;
      status = p.status;
      status?.addEventListener("change", onChange);
      update();
    });
    const unsub = subscribeRefused(update);
    return () => {
      alive = false;
      unsub();
      status?.removeEventListener("change", onChange);
    };
  }, []);
  return support;
}

/**
 * Asks for the microphone inside the tap and lets it go at once: the browser's prompt comes now,
 * at a calm moment, not later in the middle of a sentence. "unavailable": no microphone API.
 */
export async function askMic(): Promise<"granted" | "denied" | "unavailable"> {
  if (!navigator.mediaDevices?.getUserMedia) return "unavailable";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
    return "granted";
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    return name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable";
  }
}

/** Turns iOS sound on for later (his voice, the earcons): call first thing inside the tap. */
export function primeVoiceInTap(): void {
  unlockAudio();
  primeEarcons();
}

export type WakeOn = { ok: true; local: boolean } | { ok: false; reason: "mic" | "no-local" };

/**
 * Turns the wake word on from a tap. On device where Chrome can (the pack downloads now); else the
 * browser's speech service, which the line beside the control has already said. Never moves to the
 * cloud on its own: if on device listening cannot be had, it stays off and says so.
 */
export async function turnOnWake(opts: { cloud?: boolean } = {}): Promise<WakeOn> {
  primeVoiceInTap();
  if ((await askMic()) === "denied") return { ok: false, reason: "mic" };
  if (opts.cloud || !hasOnDeviceApi()) {
    setWakeSetting({ mode: "cloud", lang: "en-GB" });
    return { ok: true, local: false };
  }
  const lang = await prepareOnDevice();
  if (!lang) {
    setWakeSetting({ mode: "off" }, NO_LOCAL);
    return { ok: false, reason: "no-local" };
  }
  setWakeSetting({ mode: "local", lang });
  return { ok: true, local: true };
}
