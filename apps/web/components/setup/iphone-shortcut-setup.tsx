"use client";

import { type ReactNode, useEffect, useState } from "react";
import { SHORTCUT_NAME, shortcutConnectLink } from "@/lib/one-tap";
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
            href={shortcutUrl}
            onClick={() => {
              setAdded(true);
              if (setupToken) tabMemory.set("iphone-added", "1");
            }}
            className="press mt-2 flex h-11 w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint"
          >
            Add the shortcut
          </a>
        </Step>
        <Step n={2} done={Boolean(connected)}>
          <p>Connect it to you. Shortcuts opens for a second and says Connected.</p>
          {connected ? (
            <SecondaryButton onClick={connect}>Connect again</SecondaryButton>
          ) : (
            <PrimaryButton busy={busy} onClick={connect}>
              {busy ? "Connecting" : "Connect the shortcut"}
            </PrimaryButton>
          )}
        </Step>
        <Step n={3}>
          <p>
            In Shortcuts, tap Automation, then +, then App. Pick the apps to watch, tick Is Opened and Run
            Immediately, then choose {SHORTCUT_NAME}.
          </p>
        </Step>
      </ol>
      <ErrorLine text={error} />
    </Card>
  );
}
