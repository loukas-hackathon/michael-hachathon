"use client";

import { useState } from "react";
import { createSetupLink, type LinkResult } from "@/lib/setup-actions";
import { FirstDataWatch, startFirstData } from "./first-data-watch";
import { Card, CopyRow, ErrorLine, PrimaryButton, Step } from "./parts";

// A Windows PC in one line, like the Mac (mac-setup.tsx). One tap makes a setup token that works
// once, for 30 minutes; the line fetches the public installer (GET /v1/setup/windows.ps1), which
// installs ActivityWatch and the collector and swaps the token for a device key on the PC itself.
// The long lived key is written to the PC's .michael folder and never shown here.

export function WindowsSetup() {
  const [link, setLink] = useState<LinkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = link && "installCommand" in link && link.installCommand ? link : null;

  return (
    <Card>
      {ok?.installCommand ? (
        <ol className="flex flex-col gap-4">
          <Step n={1}>
            <p>
              Open PowerShell (press the Windows key, type PowerShell, press Enter), paste this and press
              Enter.
            </p>
            <CopyRow value={ok.installCommand} />
          </Step>
          <Step n={2}>
            <p>
              It installs ActivityWatch, which notes the app in front, and Michael. If Windows asks to allow
              ActivityWatch, say yes.
            </p>
          </Step>
          <Step n={3}>
            <p>
              When it says Michael is running, close the window. It starts again by itself when you sign in.
            </p>
          </Step>
        </ol>
      ) : (
        <>
          <p className="text-subhead">
            One line in PowerShell installs Michael on your PC and connects it to you. No key to paste.
          </p>
          <PrimaryButton
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const [made] = await Promise.all([createSetupLink("windows"), startFirstData("windows")]);
                setLink(made);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Connecting" : "Connect this PC"}
          </PrimaryButton>
        </>
      )}
      {ok ? (
        <p className="mt-4 text-footnote text-label-2">
          Works once, for 30 minutes. It only reads, and sends only to me.
        </p>
      ) : null}
      <FirstDataWatch connection="windows" active={Boolean(ok)} />
      <ErrorLine text={link && "error" in link ? link.error : null} />
    </Card>
  );
}
