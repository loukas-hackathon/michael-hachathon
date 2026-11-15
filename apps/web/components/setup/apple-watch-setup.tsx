"use client";

import { useEffect, useState } from "react";
import { HEALTH_AUTO_EXPORT_APP_STORE, healthAutoExportLinks } from "@/lib/one-tap";
import { connectHere, exchangeSetupToken, type KeyResult } from "@/lib/setup-actions";
import { FirstDataWatch, hasFirstDataNote, startFirstData } from "./first-data-watch";
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

// Apple Watch through Health Auto Export, as close to one tap as iOS allows (#120).
// On the iPhone: each tap opens Health Auto Export with a whole automation filled in (URL, key in
// the Authorization header, metrics, format, every 5 minutes) through its com.HealthExport:// deep
// link. One automation carries one data type, so it is two taps: health, then workouts.
// Anywhere else: a QR code opens this same flow on the iPhone.
// Once started, the live check below the steps waits for the first Health event (#306).
//
// `setupToken`: set on /setup/apple-watch, the page the QR code opens, where the person may not be
// signed in. The token is swapped for the key on the first tap.

type Links = ReturnType<typeof healthAutoExportLinks>;

export function AppleWatchSetup({ setupToken }: { setupToken?: string }) {
  const device = useDevice();
  const [links, setLinks] = useState<Links | null>(null);
  const [opened, setOpened] = useState<{ metrics: boolean; workouts: boolean }>({
    metrics: false,
    workouts: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Back from Health Auto Export after iOS reloaded the tab: pick up where it was.
  useEffect(() => {
    // Signed in: the live check noted that step 2 was tapped (no key is kept on this page).
    if (!setupToken) {
      if (hasFirstDataNote("apple-watch")) setOpened((o) => ({ ...o, metrics: true }));
      return;
    }
    const saved = tabMemory.get("apple-watch");
    if (saved) {
      const s = JSON.parse(saved) as { links: Links; opened: typeof opened };
      setLinks(s.links);
      setOpened(s.opened);
    }
  }, [setupToken]);

  if (device === null) return null;
  if (device !== "iphone" && !setupToken) {
    return (
      <QrHandoff
        connection="apple-watch"
        what="Your watch saves to Apple Health on your iPhone. Scan this there and I fill in Health Auto Export for you."
        after={<FirstDataWatch connection="apple-watch" active />}
      />
    );
  }

  // The key is made once, on the first tap, and kept only in this page's memory for the second.
  async function ensureLinks(): Promise<Links | null> {
    if (links) return links;
    setBusy(true);
    const r: KeyResult = setupToken ? await exchangeSetupToken(setupToken) : await connectHere("apple-watch");
    setBusy(false);
    if ("error" in r) {
      setError(r.error);
      return null;
    }
    const made = healthAutoExportLinks(r.apiBase, r.secret);
    setLinks(made);
    return made;
  }

  async function open(which: "metrics" | "workouts") {
    const [l] = await Promise.all([ensureLinks(), setupToken ? null : startFirstData("apple-watch")]);
    if (!l) return;
    const next = { ...opened, [which]: true };
    setOpened(next);
    if (setupToken) tabMemory.set("apple-watch", JSON.stringify({ links: l, opened: next }));
    window.location.href = l[which];
  }

  return (
    <Card>
      <ol className="flex flex-col gap-4">
        <Step n={1} done={opened.metrics}>
          <p>Get Health Auto Export from the App Store. Skip this if you have it.</p>
          <a
            href={HEALTH_AUTO_EXPORT_APP_STORE}
            className="press mt-2 flex h-11 w-full items-center justify-center rounded-full bg-bg text-body font-semibold text-tint-text"
          >
            Open the App Store
          </a>
        </Step>
        <Step n={2} done={opened.metrics}>
          <p>Add sleep, heart rate, HRV and steps. I fill in everything; tap Save if it asks.</p>
          {opened.metrics ? (
            <SecondaryButton onClick={() => open("metrics")}>Open again</SecondaryButton>
          ) : (
            <PrimaryButton busy={busy} onClick={() => open("metrics")}>
              {busy ? "Connecting" : "Add sleep and heart rate"}
            </PrimaryButton>
          )}
        </Step>
        <Step n={3} done={opened.workouts}>
          <p>Back here, add workouts the same way.</p>
          {opened.workouts ? (
            <SecondaryButton onClick={() => open("workouts")}>Open again</SecondaryButton>
          ) : (
            <PrimaryButton busy={busy} disabled={!opened.metrics} onClick={() => open("workouts")}>
              Add workouts
            </PrimaryButton>
          )}
        </Step>
      </ol>
      <p className="mt-4 text-footnote text-label-2">
        Allow Health access when the app asks. Your first data shows here within minutes.
      </p>
      <ErrorLine text={error} />
      <FirstDataWatch connection="apple-watch" active={opened.metrics && !setupToken} />
    </Card>
  );
}
