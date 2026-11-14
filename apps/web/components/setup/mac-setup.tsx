"use client";

import { useState } from "react";
import { macCommandFile, zipExecutable } from "@/lib/one-tap";
import { createSetupLink, type LinkResult } from "@/lib/setup-actions";
import { Card, CopyRow, ErrorLine, PrimaryButton, SecondaryButton, Step, useDevice } from "./parts";

// The Mac collector in one line (#120). One tap makes a setup token that works once, for 30
// minutes; the line (or the downloaded Michael.command, which runs the same line) fetches the public
// installer and swaps the token for a device key on the Mac itself. The long lived key is written
// to ~/.michael on the Mac and never shown here, put in a URL or kept in the shell history.

export function MacSetup() {
  const device = useDevice();
  const [link, setLink] = useState<LinkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = link && "installCommand" in link && link.installCommand ? link : null;

  function download(command: string) {
    const zip = zipExecutable("Michael.command", macCommandFile(command));
    const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "Michael.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <Card>
      {device && device !== "mac" ? (
        <p className="mb-3 text-subhead text-label-2">Do this on your Mac: open Michael there, You, Mac.</p>
      ) : null}
      {ok?.installCommand ? (
        <ol className="flex flex-col gap-4">
          <Step n={1}>
            <p>Open Terminal (press Command and Space, type Terminal), paste this and press Return.</p>
            <CopyRow value={ok.installCommand} />
            <p className="mt-2 text-footnote text-label-2">
              Or download it and double-click Michael.command. If macOS stops it, open System Settings,
              Privacy and Security, and tap Open Anyway.
            </p>
            <SecondaryButton onClick={() => download(ok.installCommand ?? "")}>
              Download for Mac
            </SecondaryButton>
          </Step>
          <Step n={2}>
            <p>When the Full Disk Access list opens, turn on Terminal. That is how I see app time.</p>
          </Step>
          <Step n={3}>
            <p>Leave the window open. It starts again by itself when you log in.</p>
          </Step>
        </ol>
      ) : (
        <>
          <p className="text-subhead">
            One line installs Michael on your Mac and connects it to you. No admin password, no key to paste.
          </p>
          <PrimaryButton
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setLink(await createSetupLink("mac"));
              setBusy(false);
            }}
          >
            {busy ? "Connecting" : "Connect this Mac"}
          </PrimaryButton>
        </>
      )}
      {ok ? (
        <p className="mt-4 text-footnote text-label-2">
          Works once, for 30 minutes. It only reads, and sends only to me.
        </p>
      ) : null}
      <ErrorLine text={link && "error" in link ? link.error : null} />
    </Card>
  );
}
