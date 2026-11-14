"use client";

import type { SetupConnection } from "@michael/shared";
import { useEffect, useState } from "react";
import { AppleWatchSetup } from "@/components/setup/apple-watch-setup";
import { IPhoneShortcutSetup } from "@/components/setup/iphone-shortcut-setup";
import { tabMemory } from "@/components/setup/parts";

// Reads the setup token from the fragment once, then clears it from the address bar and history.
export function SetupFromLink({
  connection,
  shortcutUrl,
}: {
  connection: SetupConnection;
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

  if (token === undefined || connection === "mac") return null;
  if (token === null) {
    return (
      <p className="rounded-group bg-fill px-4 py-3 text-subhead">
        This link is not complete. Scan the code in Michael again.
      </p>
    );
  }
  if (connection === "apple-watch") return <AppleWatchSetup setupToken={token} />;
  return (
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
