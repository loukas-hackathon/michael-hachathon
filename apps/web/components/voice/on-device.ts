// On device speech recognition, where the browser has it (Chrome 139 and later, Edge behind a
// flag as of late 2026): `SpeechRecognition.available({ langs, processLocally: true })` says
// whether a language pack is on the device, `SpeechRecognition.install(...)` downloads one, and a
// recogniser with `processLocally = true` never sends audio anywhere. Browsers answer
// "downloadable" until the site has called install() once, so the true state is only known after
// that. Safari has neither call: its recogniser may run on the device or on Apple's servers, and
// the page cannot tell, so it counts as the browser's speech service.

import { recognitionCtor } from "./speech";

type Availability = "available" | "downloadable" | "downloading" | "unavailable";
type Options = { langs: string[]; processLocally: boolean };
type LocalApi = {
  available?: (o: Options) => Promise<Availability>;
  install?: (o: Options) => Promise<boolean>;
};

/** British English first; the US pack is the one Chrome is most likely to have. */
const LANGS = ["en-GB", "en-US"];

export type OnDevice =
  /** A language pack is on the device: nothing leaves it. */
  | { kind: "ready"; lang: string }
  /** One can be downloaded on the first switch on. */
  | { kind: "download"; lang: string }
  /** Only the browser's speech service (cloud), or the browser cannot say. */
  | { kind: "none" };

function api(): LocalApi | null {
  const Ctor = recognitionCtor() as unknown as LocalApi | null;
  return Ctor && typeof Ctor.available === "function" ? Ctor : null;
}

/** Whether the browser has the on device calls at all, without calling them. */
export const hasOnDeviceApi = (): boolean => api() !== null;

/**
 * What on device recognition this browser offers for English. Only called inside the switch's
 * tap, never on page load: in headless Chromium (Playwright, Nov 2026) `available()` crashes the
 * renderer, and an untested Chrome without the speech component might do the same.
 */
export async function onDeviceStatus(): Promise<OnDevice> {
  const local = api();
  if (!local?.available) return { kind: "none" };
  let download: string | null = null;
  for (const lang of LANGS) {
    try {
      const status = await local.available({ langs: [lang], processLocally: true });
      if (status === "available") return { kind: "ready", lang };
      if ((status === "downloadable" || status === "downloading") && !download) download = lang;
    } catch {
      // An old shape of the call, or the page is not active: try the next language.
    }
  }
  return download ? { kind: "download", lang: download } : { kind: "none" };
}

/**
 * Makes on device recognition ready, inside the switch's tap (Chrome may want a gesture for the
 * download). Resolves the language to listen in, or null when only the cloud is left.
 */
export async function prepareOnDevice(): Promise<string | null> {
  const status = await onDeviceStatus();
  if (status.kind === "ready") return status.lang;
  if (status.kind === "none") return null;
  try {
    const ok = await api()?.install?.({ langs: [status.lang], processLocally: true });
    return ok ? status.lang : null;
  } catch {
    return null;
  }
}
