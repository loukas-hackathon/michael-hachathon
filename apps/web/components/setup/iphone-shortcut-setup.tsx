"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, startTransition, useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import { useStandalone } from "@/components/standalone";
import {
  isICloudLink,
  SHORTCUT_FILE,
  SHORTCUT_NAME,
  shortcutAddInNewContext,
  shortcutConnectLink,
  shortcutTestLink,
} from "@/lib/one-tap";
import { connectHere, exchangeSetupToken } from "@/lib/setup-actions";
import {
  Card,
  ErrorLine,
  PrimaryButton,
  QrHandoff,
  SecondaryButton,
  Step,
  tabMemory,
  useDevice,
} from "./parts";

// Live iPhone app opens through the Michael shortcut (#120, #303, docs/sources/ios-shortcuts.md).
// 1. Add the shortcut: its iCloud link (Shortcuts opens on Add Shortcut, no browser), or the
//    signed file this app serves as the fallback.
// 2. Connect: a shortcuts:// link runs it once with the device key as input; it saves the key.
// 3. The app automation: Apple lets no app or link create one, so that part stays a few taps.
// Without a shortcut link it shows `fallback` instead (the pages always pass one since #303).
// The iCloud link (the default since Loukas shared it, 15 Nov) opens Shortcuts itself; from the
// installed app in a new context, so this page stays put. "Shortcuts did not open?" offers our own
// file, in this window: iOS shows its preview with Open in Shortcuts and the import works. A new
// context for the file did not: the in-app sheet stayed blank (#497, #508). Coming back to Michael,
// the page picks up where it was (pageshow, visibilitychange, tab memory).
// Never shortcuts://import-shortcut: it refuses anything but an iCloud link ("Import Failed").

/** How long after coming back from a test run its event may take to land. */
const TEST_WAIT_MS = 6000;

export function IPhoneShortcutSetup({
  shortcutUrl,
  setupToken,
  fallback,
  live,
}: {
  /** Where the shortcut is added from: `shortcutUrl()` in lib/one-tap.ts, read on the server. */
  shortcutUrl: string | null;
  setupToken?: string;
  fallback?: ReactNode;
  /** The iPhone connection has data (an app open or a test landed): read on the server. */
  live?: boolean;
}) {
  const device = useDevice();
  const [added, setAdded] = useState(false);
  const [connected, setConnected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const standalone = useStandalone();
  const router = useRouter();
  const connectRef = useRef<HTMLDivElement>(null);
  const iCloud = shortcutUrl !== null && isICloudLink(shortcutUrl);

  // Back from Shortcuts: after Add, the next step is Connect, so bring it into view; after
  // Connect or a test, read the connection again so its state shows without a reload.
  const state = useRef({ added, connected, testing });
  state.current = { added, connected, testing };
  useEffect(() => {
    const onBack = () => {
      if (document.visibilityState !== "visible") return;
      // Back from the file's preview in this window: the steps as they were.
      if (tabMemory.get("iphone-added")) setAdded(true);
      const { added: a, connected: c, testing: t } = state.current;
      if (c || t) startTransition(() => router.refresh());
      else if (a) {
        connectRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        connectRef.current?.querySelector("button")?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("pageshow", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("pageshow", onBack);
    };
  }, [router]);

  // Back from Shortcuts after iOS reloaded the tab: pick up where it was.
  useEffect(() => {
    if (tabMemory.get("iphone-added")) setAdded(true);
    if (setupToken) setConnected(tabMemory.get("iphone"));
  }, [setupToken]);

  // After Send a test: if nothing lands within a few seconds of coming back, Michael is missing.
  useEffect(() => {
    if (!testing || live) {
      setNotFound(false);
      return;
    }
    let timer = 0;
    const wait = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setNotFound(true), TEST_WAIT_MS);
    };
    document.addEventListener("visibilitychange", wait);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wait);
    };
  }, [testing, live]);

  // Only an iCloud link leaves the installed app; our own file stays in this window.
  const newContext = shortcutUrl !== null && shortcutAddInNewContext(shortcutUrl, standalone);

  if (!shortcutUrl) return <>{fallback ?? null}</>;
  if (device === null) return null;
  if (device !== "iphone" && !setupToken) {
    return (
      <QrHandoff
        connection="iphone"
        what="Scan this on your iPhone. It adds the Michael shortcut and connects it to you."
      />
    );
  }

  async function connect() {
    if (connected) {
      window.location.href = connected;
      return;
    }
    setBusy(true);
    const r = setupToken ? await exchangeSetupToken(setupToken) : await connectHere("iphone");
    setBusy(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    const link = shortcutConnectLink(r.secret);
    setConnected(link);
    if (setupToken) tabMemory.set("iphone", link);
    window.location.href = link;
  }

  return (
    <Card>
      <ol className="flex flex-col gap-4">
        <Step n={1} done={added}>
          <p>Add the {SHORTCUT_NAME} shortcut, then come back here.</p>
          <a
            href={shortcutUrl}
            // Our file: this window, where iOS previews it with Open in Shortcuts. An iCloud link in
            // the installed app: a new context (Shortcuts), so this page stays put.
            {...(newContext ? { target: "_blank", rel: "noopener" } : {})}
            onClick={() => {
              setAdded(true);
              setNotFound(false);
              tabMemory.set("iphone-added", "1");
            }}
            className="press mt-2 flex h-11 w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint"
          >
            Add the shortcut
          </a>
          {iCloud ? (
            <button
              type="button"
              onClick={() => setHelp(true)}
              className="press mx-auto mt-1 flex h-11 items-center px-2 text-subhead font-semibold text-tint-text"
            >
              Shortcuts did not open?
            </button>
          ) : null}
        </Step>
        <Step n={2} done={Boolean(connected)}>
          <div ref={connectRef}>
            <p>
              {added
                ? "Connect it to you. Shortcuts opens for a second and says Connected."
                : "Add the shortcut first, then connect it here."}
            </p>
            {connected ? (
              <SecondaryButton onClick={connect}>Connect again</SecondaryButton>
            ) : (
              <PrimaryButton busy={busy} onClick={connect}>
                {busy ? "Connecting" : "Connect the shortcut"}
              </PrimaryButton>
            )}
          </div>
        </Step>
        {/* The test (#466): a hand run posts with the key and no app, and the row turns Connected. */}
        <Step n={3}>
          <p>Send a test. Shortcuts runs {SHORTCUT_NAME} once and this page says Connected.</p>
          <a
            href={shortcutTestLink()}
            onClick={() => {
              setNotFound(false);
              setTesting(true);
            }}
            className="press mt-2 flex h-11 w-full items-center justify-center rounded-full bg-tint/14 text-body font-semibold text-tint-text"
          >
            Send a test
          </a>
          {notFound ? (
            <p className="mt-2 text-subhead text-label-2">
              Shortcuts could not find {SHORTCUT_NAME}. Add it first, then Connect.
            </p>
          ) : null}
        </Step>
        <Step n={4}>
          <p>
            Then the app opens: in Shortcuts, tap Automation, then +, then App. Pick the apps to watch, tick
            Is Opened and Run Immediately, then choose {SHORTCUT_NAME}. Apple lets only you add this.
          </p>
        </Step>
      </ol>
      <ErrorLine text={error} />
      <Sheet open={help} onClose={() => setHelp(false)} title="Add the shortcut" closeLabel="Done">
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-body">
          <li>Tap Open the shortcut file.</li>
          <li>Tap Open in Shortcuts, then Add Shortcut.</li>
          <li>Come back to Michael and tap Connect the shortcut.</li>
        </ol>
        <a
          href={SHORTCUT_FILE}
          onClick={() => {
            setHelp(false);
            setAdded(true);
            tabMemory.set("iphone-added", "1");
          }}
          className="press mt-6 flex h-11 w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint"
        >
          Open the shortcut file
        </a>
      </Sheet>
    </Card>
  );
}
