"use client";

import { FOCUS_SHORTCUT_NAME, focusShortcutInput } from "@michael/shared/focus-shortcut";
import { useEffect, useState } from "react";
import { tryDndNudgeAction } from "@/app/dnd/actions";
import { useStandalone } from "@/components/standalone";
import { FOCUS_SHORTCUT_FILE, focusShortcutAdded, focusShortcutLink } from "@/lib/dnd";
import { shortcutAddInNewContext } from "@/lib/one-tap";
import { Card, ErrorLine, SecondaryButton, Step, useDevice } from "./parts";

// The Michael Focus shortcut (#447): the one thing that may switch on Do Not Disturb, since no app
// or page can. Added once per device. When a nudge asks "Do Not Disturb until 14:00?" and the
// person says yes, Michael runs it: on the iPhone from the page the nudge opens, on the Mac through
// Michael for Mac. Nothing is switched on without that tap.

const TRY_MS = 2 * 60_000;

export function FocusShortcutSetup({
  url = FOCUS_SHORTCUT_FILE,
}: {
  /** `focusShortcutUrl()` in lib/dnd.ts, read on the server: an iCloud link or our own file. */
  url?: string;
}) {
  const device = useDevice();
  // An iCloud link leaves the installed app for Shortcuts; our own file stays in this window.
  const newContext = shortcutAddInNewContext(url, useStandalone());
  const [added, setAdded] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The file opens in this window, in the installed app too: iOS previews it with Open in
  // Shortcuts, which a new context did not (as in iphone-shortcut-setup.tsx). Coming back to
  // Michael, Step 1 reads as done.
  useEffect(() => {
    const read = () => setAdded(focusShortcutAdded.get());
    read();
    window.addEventListener("pageshow", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.removeEventListener("pageshow", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);
  if (device === null) return null;

  // The whole path once: the nudge arrives, its tap opens the page that asks and hands over.
  const sendNudge = async () => {
    setError(null);
    const r = await tryDndNudgeAction();
    if (r.ok) setSent(r.text);
    else setError(r.error);
  };

  const add = (
    <a
      href={url}
      {...(newContext ? { target: "_blank", rel: "noopener" } : {})}
      onClick={() => {
        focusShortcutAdded.set();
        setAdded(true);
      }}
      className="press mt-2 flex h-11 w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint"
    >
      Add Michael Focus
    </a>
  );

  if (device !== "iphone") {
    return (
      <Card>
        <p className="text-subhead">
          {device === "mac"
            ? `Add the ${FOCUS_SHORTCUT_NAME} shortcut to this Mac. With Michael for Mac running, I switch on Do Not Disturb when you say yes in a nudge, and your iPhone follows.`
            : `Open this page on your iPhone or your Mac to add the ${FOCUS_SHORTCUT_NAME} shortcut.`}
        </p>
        {device === "mac" ? add : null}
      </Card>
    );
  }

  // One or two minutes from now, to the minute: long enough to see the moon, short enough to forget.
  const tryIt = () => {
    const until = new Date(Math.ceil((Date.now() + TRY_MS) / 60_000) * 60_000).toISOString();
    window.location.href = focusShortcutLink(
      focusShortcutInput(until, Intl.DateTimeFormat().resolvedOptions().timeZone),
    );
  };

  return (
    <Card>
      <ol className="flex flex-col gap-4">
        <Step n={1} done={added}>
          <p>Add the {FOCUS_SHORTCUT_NAME} shortcut, then come back here.</p>
          {add}
        </Step>
        <Step n={2}>
          <p>
            {added
              ? "Try it. Do Not Disturb comes on for two minutes at most, then ends by itself."
              : `Add ${FOCUS_SHORTCUT_NAME} first, then try it here.`}
          </p>
          <SecondaryButton onClick={tryIt}>Try it</SecondaryButton>
        </Step>
        <Step n={3}>
          <p>See how I ask. I send the late phone nudge now; tap it when it arrives.</p>
          <SecondaryButton onClick={sendNudge}>Send me the nudge</SecondaryButton>
          {sent ? <p className="mt-2 text-footnote text-label-2 tnum">Sent: {sent}</p> : null}
        </Step>
      </ol>
      <ErrorLine text={error} />
    </Card>
  );
}
