"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, startTransition, useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import { useStandalone } from "@/components/standalone";
import { SHORTCUT_NAME, shortcutAddLink, shortcutConnectLink, shortcutTestLink } from "@/lib/one-tap";
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
// 1. Add the shortcut: the signed file this app serves, or its iCloud link (Add Shortcut).
// 2. Connect: a shortcuts:// link runs it once with the device key as input; it saves the key.
// 3. The app automation: Apple lets no app or link create one, so that part stays a few taps.
// Without a shortcut link it shows `fallback` instead (the pages always pass one since #303).
// In the installed app (no browser chrome) Add never loads the file in the app's own window, which
// left Loukas on a page with no way back: it opens the absolute link in a new context (Safari for
// our file, Shortcuts for an iCloud link), with a sheet of steps (and Done) if nothing opens.
// Never shortcuts://import-shortcut: it refuses anything but an iCloud link ("Import Failed").

export function IPhoneShortcutSetup({
  shortcutUrl,
  setupToken,
  fallback,
}: {
  /** Where the shortcut is added from: `shortcutUrl()` in lib/one-tap.ts, read on the server. */
  shortcutUrl: string | null;
  setupToken?: string;
  fallback?: ReactNode;
}) {
  const device = useDevice();
  const [added, setAdded] = useState(false);
  const [connected, setConnected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const standalone = useStandalone();
  const router = useRouter();
  const connectRef = useRef<HTMLDivElement>(null);
  // Absolute links need the page's origin, so they are made once mounted.
  const [links, setLinks] = useState<{ add: string; file: string } | null>(null);
  useEffect(() => {
    if (!shortcutUrl) return;
    const origin = window.location.origin;
    // Add and Open in Safari use the same absolute https URL.
    const add = shortcutAddLink(shortcutUrl, origin);
    setLinks({ add, file: add });
  }, [shortcutUrl]);

  // Back from Shortcuts: after Add, the next step is Connect, so bring it into view; after
  // Connect, read the connection again so its state shows without a reload.
  const state = useRef({ added, connected });
  state.current = { added, connected };
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const { added: a, connected: c } = state.current;
      if (c) startTransition(() => router.refresh());
      else if (a) {
        connectRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        connectRef.current?.querySelector("button")?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  // Back from Shortcuts after iOS reloaded the tab: pick up where it was.
  useEffect(() => {
    if (!setupToken) return;
    if (tabMemory.get("iphone-added")) setAdded(true);
    setConnected(tabMemory.get("iphone"));
  }, [setupToken]);

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
            href={standalone && links ? links.add : shortcutUrl}
            // Installed app: a new context (Safari, or Shortcuts for iCloud), so this page stays put.
            {...(standalone ? { target: "_blank", rel: "noopener" } : {})}
            onClick={() => {
              setAdded(true);
              if (setupToken) tabMemory.set("iphone-added", "1");
            }}
            className="press mt-2 flex h-11 w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint"
          >
            Add the shortcut
          </a>
          {standalone ? (
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
            <p>Connect it to you. Shortcuts opens for a second and says Connected.</p>
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
            className="press mt-2 flex h-11 w-full items-center justify-center rounded-full bg-tint/14 text-body font-semibold text-tint-text"
          >
            Send a test
          </a>
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
          <li>Tap Open in Safari.</li>
          <li>
            {links && /(^|\.)icloud\.com$/.test(new URL(links.file).hostname)
              ? "Tap Get Shortcut, then Add Shortcut."
              : `Tap Download, then the download arrow, then ${SHORTCUT_NAME}. Tap Add Shortcut.`}
          </li>
          <li>Come back to Michael and tap Connect the shortcut.</li>
        </ol>
        {links ? (
          <a
            href={links.file}
            target="_blank"
            rel="noopener"
            onClick={() => setHelp(false)}
            className="press mt-6 flex h-11 w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint"
          >
            Open in Safari
          </a>
        ) : null}
      </Sheet>
    </Card>
  );
}
