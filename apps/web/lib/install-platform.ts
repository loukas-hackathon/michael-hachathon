// Which way Michael can be installed from this browser, for the "Get the app" row on /login.
// Pure, so the unit test can feed it user agents; components/install-app.tsx reads the browser.

export type InstallPlatform =
  /** Already running from the Home Screen or as an installed app: say nothing. */
  | "installed"
  /** Safari on iPhone or iPad: Share, Add to Home Screen. */
  | "ios-safari"
  /** Chrome, Firefox, Edge or an in-app browser on iPhone: open the page in Safari first. */
  | "ios-other"
  /** Anything else: only Chrome and Edge can install, and they say so with beforeinstallprompt. */
  | "wait-for-prompt";

export type InstallEnv = {
  userAgent: string;
  /** navigator.maxTouchPoints: iPadOS Safari calls itself a Mac, but a Mac has no touch screen. */
  maxTouchPoints?: number;
  /** matchMedia("(display-mode: standalone)") (or fullscreen, minimal-ui) matched. */
  standalone?: boolean;
  /** navigator.standalone, Safari's own flag for a Home Screen app. */
  iosStandalone?: boolean;
};

export function isIOSDevice(env: Pick<InstallEnv, "userAgent" | "maxTouchPoints">): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true;
  return /Macintosh/.test(env.userAgent) && (env.maxTouchPoints ?? 0) > 1;
}

// Other browsers on iOS name themselves; in-app views (Instagram, Facebook, LinkedIn, Gmail's and
// Google's) either name the app or leave out the "Safari/" token that real Safari always sends.
const IOS_NOT_SAFARI =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|GSA\/|FBAN|FBAV|Instagram|LinkedInApp|Line\/|Twitter|MicroMessenger|Snapchat|TikTok|musical_ly/;

export function installPlatform(env: InstallEnv): InstallPlatform {
  if (env.standalone || env.iosStandalone) return "installed";
  if (isIOSDevice(env)) {
    const safari = /Safari\//.test(env.userAgent) && !IOS_NOT_SAFARI.test(env.userAgent);
    return safari ? "ios-safari" : "ios-other";
  }
  return "wait-for-prompt";
}

/** localStorage key: set once the person says not now, per device. */
export const INSTALL_DISMISSED_KEY = "michael.install.dismissed";
