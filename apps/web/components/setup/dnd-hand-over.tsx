"use client";

import type { Dnd, DndOffer } from "@michael/shared";
import { useEffect, useState } from "react";
import { endDndAction, startDndAction } from "@/app/dnd/actions";
import { FOCUS_SHORTCUT_FILE, focusShortcutAdded, focusShortcutLink, focusShortcutOffLink } from "@/lib/dnd";
import { Card, ErrorLine, PrimaryButton, SecondaryButton, Step, useDevice } from "./parts";

// The page a nudge's Do Not Disturb opens (#447). Michael asks, one tap, he does it, it ends by
// itself, and it can be ended here. Three places it can happen:
//   an iPhone      the tap records it, then hands over to the Michael Focus shortcut;
//   a Mac          the collector runs the same shortcut within seconds (`mac: ready`);
//   neither ready  the page offers to add the shortcut first, so the tap never fails silently.
// Nothing is switched on before the tap.

export function DndHandOver({ offer }: { offer: DndOffer | null }) {
  const device = useDevice();
  const [on, setOn] = useState<Dnd | null>(offer?.active ?? null);
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  useEffect(() => setAdded(focusShortcutAdded.get()), []);

  if (device === null) return null;
  if (!offer) {
    return (
      <Card>
        <p className="text-subhead">I could not read this just now. Open Michael and try again.</p>
      </Card>
    );
  }

  const phone = device === "iphone";
  const macReady = offer.mac === "ready";
  // The shortcut has to be there before the tap can do anything: on this iPhone, or on the Mac.
  const needsShortcut = phone ? !added : !macReady;

  async function switchOn() {
    if (!offer?.offer) return;
    setBusy(true);
    setError(null);
    const r = await startDndAction(offer.offer.nudge_id);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setOn(r.dnd);
    setEnded(false);
    // The iPhone does it itself: Shortcuts opens for a second and sets the Focus.
    if (phone) window.location.href = focusShortcutLink(r.dnd.shortcut_input);
  }

  async function end() {
    if (!on) return;
    setBusy(true);
    setError(null);
    const r = await endDndAction(on.id);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setOn(null);
    setEnded(true);
    if (phone) window.location.href = focusShortcutOffLink();
  }

  if (on) {
    return (
      <Card>
        <p className="text-title3 font-bold tnum">Do Not Disturb is on until {on.until_label}.</p>
        <p className="mt-1 text-subhead text-label-2">
          {phone
            ? "It ends by itself. If the moon is not in the status bar, tap Switch it on again."
            : on.mac || macReady
              ? "Your Mac switches it on within seconds, and your iPhone follows. It ends by itself."
              : "Open this page on your iPhone to switch it on there. It ends by itself."}
        </p>
        {phone ? (
          <SecondaryButton onClick={() => (window.location.href = focusShortcutLink(on.shortcut_input))}>
            Switch it on again
          </SecondaryButton>
        ) : null}
        <PrimaryButton busy={busy} onClick={end}>
          {busy ? "Ending" : "End it now"}
        </PrimaryButton>
        <ErrorLine text={error} />
      </Card>
    );
  }

  if (!offer.offer) {
    return (
      <Card>
        <p className="text-subhead">
          {ended
            ? "Do Not Disturb is off."
            : "Nothing to protect right now. I offer this when your phone pulls you out of a block, or late at night."}
        </p>
      </Card>
    );
  }

  const ask = (
    <>
      <p className="text-title3 font-bold tnum">Do Not Disturb until {offer.offer.until_label}?</p>
      <p className="mt-1 text-subhead text-label-2">
        One tap and I switch it on. It ends by itself at {offer.offer.until_label}, and you can end it sooner
        here.
      </p>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {ended ? <p className="px-4 text-subhead font-semibold">Do Not Disturb is off.</p> : null}
      <p className="px-4 text-subhead text-label-2 tnum">{offer.offer.text}</p>
      <Card>
        {needsShortcut ? (
          <>
            {ask}
            <ol className="mt-4 flex flex-col gap-4">
              <Step n={1}>
                <p>
                  {phone
                    ? "Once only: add the Michael Focus shortcut, then come back here."
                    : offer.mac === "away"
                      ? "Your Mac is not reporting in. Start Michael for Mac, then add the Michael Focus shortcut to it, once only."
                      : "Once only: add the Michael Focus shortcut to this Mac."}
                </p>
                <a
                  href={FOCUS_SHORTCUT_FILE}
                  onClick={() => {
                    focusShortcutAdded.set();
                    setAdded(true);
                  }}
                  className="press mt-2 flex h-11 w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint"
                >
                  Add Michael Focus
                </a>
              </Step>
              <Step n={2}>
                <p>
                  {phone
                    ? "Then switch it on."
                    : "Then switch it on. Your Mac does it as soon as the shortcut is there."}
                </p>
                <SecondaryButton onClick={switchOn}>{busy ? "Switching on" : "Switch it on"}</SecondaryButton>
              </Step>
            </ol>
          </>
        ) : (
          <>
            {ask}
            <PrimaryButton busy={busy} onClick={switchOn}>
              {busy ? "Switching on" : "Switch it on"}
            </PrimaryButton>
            {phone ? (
              <p className="mt-3 text-footnote text-label-2">
                Shortcuts opens for a second. Shortcut gone?{" "}
                <a href={FOCUS_SHORTCUT_FILE} className="font-semibold text-tint-text">
                  Add it again
                </a>
                .
              </p>
            ) : null}
          </>
        )}
        <ErrorLine text={error} />
      </Card>
    </div>
  );
}
