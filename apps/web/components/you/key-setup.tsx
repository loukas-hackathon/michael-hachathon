"use client";

import { useState } from "react";
import { createDeviceKey, type KeyResult } from "@/app/you/connections/key-actions";

// Setup by hand for a connection that needs a personal key (today: iPhone Shortcuts before the
// Michael shortcut is published): numbered steps, one Connect tap that makes the key, then one
// Copy button. The link itself stays hidden unless the clipboard is blocked, and is never stored.

export type CopyAs =
  | { kind: "webhook"; path: string } // a full webhook URL with the key in it
  | { kind: "collector" }; // the one line that starts the Mac collector

type Props = {
  keyName: string;
  copyAs: CopyAs;
  /** What to do after copying, in plain words. Step 1 (Connect, then Copy) is added here. */
  steps: string[];
};

function valueFor(r: Extract<KeyResult, { secret: string }>, copyAs: CopyAs) {
  if (copyAs.kind === "webhook") return `${r.apiBase}/v1/webhooks/${copyAs.path}?key=${r.secret}`;
  return `MICHAEL_API_URL=${r.apiBase} MICHAEL_API_KEY=${r.secret} pnpm collect`;
}

const PRIMARY =
  "press mt-4 flex h-11 w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint disabled:opacity-60";

export function KeySetup({ keyName, copyAs, steps }: Props) {
  const [result, setResult] = useState<KeyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "blocked">("idle");
  const value = result && "secret" in result ? valueFor(result, copyAs) : null;

  async function copyValue() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopy("copied");
    } catch {
      // Clipboard blocked: show the link so it can be selected by hand.
      setCopy("blocked");
    }
  }

  return (
    <section className="rounded-group bg-fill px-4 py-4">
      <ol className="list-decimal space-y-2 pl-5 text-subhead">
        <li>{value ? "Copy your link." : "Tap Connect. I make a link for your iPhone only."}</li>
        {steps.map((s) => (
          <li key={s} className={value ? "" : "text-label-2"}>
            {s}
          </li>
        ))}
      </ol>
      {value ? (
        <>
          <button type="button" onClick={copyValue} className={PRIMARY}>
            {copy === "copied" ? "Copied" : "Copy your link"}
          </button>
          {copy === "blocked" ? (
            <code className="mt-2 block rounded-group bg-bg px-3 py-2 text-footnote break-all select-all">
              {value}
            </code>
          ) : null}
          <p role="status" className="mt-2 min-h-5 text-footnote text-label-2">
            {copy === "blocked"
              ? "I could not copy it. Select the link above and copy it."
              : "This link is yours alone. Keep it private."}
          </p>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setResult(await createDeviceKey(keyName));
            } catch {
              setResult({ error: "I could not reach the server. Tap Connect again." });
            } finally {
              setBusy(false);
            }
          }}
          className={PRIMARY}
        >
          {busy ? "Connecting" : "Connect"}
        </button>
      )}
      {result && "error" in result ? (
        <p role="alert" className="mt-2 text-footnote text-danger">
          {result.error}
        </p>
      ) : null}
    </section>
  );
}
