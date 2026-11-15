import assert from "node:assert/strict";
import { test } from "node:test";
import { installPlatform } from "./install-platform";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101",
  iphoneWebView:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ipadDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  desktopFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0",
};

test("Safari on iPhone and iPad gets the Home Screen steps", () => {
  assert.equal(installPlatform({ userAgent: UA.iphoneSafari, maxTouchPoints: 5 }), "ios-safari");
  // iPadOS Safari sends a Mac user agent; the touch screen gives it away.
  assert.equal(installPlatform({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 }), "ios-safari");
});

test("other browsers and in-app views on iPhone are sent to Safari", () => {
  for (const ua of [UA.iphoneChrome, UA.iphoneFirefox, UA.iphoneInstagram, UA.iphoneWebView]) {
    assert.equal(installPlatform({ userAgent: ua, maxTouchPoints: 5 }), "ios-other", ua);
  }
});

test("everything else waits for the browser's own install prompt", () => {
  assert.equal(installPlatform({ userAgent: UA.androidChrome, maxTouchPoints: 5 }), "wait-for-prompt");
  // A Mac has no touch screen, so desktop Safari is not mistaken for an iPad (and stays hidden).
  assert.equal(installPlatform({ userAgent: UA.ipadDesktop, maxTouchPoints: 0 }), "wait-for-prompt");
  assert.equal(installPlatform({ userAgent: UA.desktopFirefox }), "wait-for-prompt");
});

test("an installed app says nothing", () => {
  assert.equal(installPlatform({ userAgent: UA.iphoneSafari, iosStandalone: true }), "installed");
  assert.equal(installPlatform({ userAgent: UA.androidChrome, standalone: true }), "installed");
  assert.equal(installPlatform({ userAgent: UA.iphoneChrome, standalone: true }), "installed");
});
