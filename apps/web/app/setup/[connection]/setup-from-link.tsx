"use client";

import type { SetupConnection } from "@michael/shared";
import { useEffect, useState } from "react";
import { AppleWatchSetup } from "@/components/setup/apple-watch-setup";
import { IPhoneShortcutSetup } from "@/components/setup/iphone-shortcut-setup";
import { tabMemory } from "@/components/setup/parts";

const SOON = "Coming soon. I will tell you when it is ready.";

// Reads the setup token from the fragment once, then clears it from the address bar and history.
export function SetupFromLink({
  connection,
  live,
  body,
  shortcutUrl,
}: {
  connection: SetupConnection;
  /** False: Coming soon, unless a setup token (made in preview, #306) came with the link. */
  live: boolean;
  body: string;
  shortcutUrl: string | null;
}) {
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (fromHash) {
      window.history.replaceState(null, "", window.location.pathname);
      if (fromHash.startsWith("ms_")) tabMemory.set(`token-${connection}`, fromHash);
    }
    const t = tabMemory.get(`token-${connection}`) ?? fromHash;
    setToken(t?.startsWith("ms_") ? t : null);
  }, [connection]);

  // Until the fragment is read, keep the line's room so nothing jumps.
  if (token === undefined) return <p className="mt-2 min-h-12 text-body text-label-2">{live ? body : ""}</p>;
  if (!live && !token) return <p className="mt-2 text-body text-label-2">{SOON}</p>;

  let steps = null;
  if (token === null) {
    steps = (
      <p className="rounded-group bg-fill px-4 py-3 text-subhead">
        This link is not complete. Scan the code in Michael again.
      </p>
    );
  } else if (connection === "apple-watch") {
    steps = <AppleWatchSetup setupToken={token} />;
  } else if (connection === "iphone") {
    steps = (
      <IPhoneShortcutSetup
        shortcutUrl={shortcutUrl}
        setupToken={token}
        fallback={
          <p className="rounded-group bg-fill px-4 py-3 text-subhead">
            The Michael shortcut is not published yet. Set this up from Michael on your iPhone instead.
          </p>
        }
      />
    );
  }
  return (
    <>
      <p className="mt-2 text-body text-label-2">{body}</p>
      {steps ? <div className="mt-6">{steps}</div> : null}
    </>
  );
}
