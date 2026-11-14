"use client";

import { useState } from "react";
import { createDeviceKey, type KeyResult } from "@/app/you/connections/key-actions";

// Setup for a connection that needs a personal key (Mac, Apple Watch, iPhone Shortcuts): numbered
// steps, one Connect tap that makes the key, then one Copy button with everything to paste.
// The key is shown once and never stored in the browser.

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

export function KeySetup({ keyName, copyAs, steps }: Props) {
  const [result, setResult] = useState<KeyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const value = result && "secret" in result ? valueFor(result, copyAs) : null;

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard blocked: the value is selectable below.
    }
  }

  return (
    <section className="rounded-group bg-fill px-4 py-4">
      <ol className="list-decimal space-y-2 pl-5 text-subhead">
        <li>
          {value
            ? "Copy this. It is your own private link to Michael."
            : "Tap Connect. I make a key for this device only."}
        </li>
        {steps.map((s) => (
          <li key={s} className={value ? "" : "text-label-2"}>
            {s}
          </li>
        ))}
      </ol>
      {value ? (
        <>
          <div className="mt-4 flex items-center gap-2 rounded-group bg-bg py-1.5 pr-1.5 pl-3">
            <code className="min-w-0 flex-1 truncate text-footnote select-all">{value}</code>
            <button
              type="button"
              onClick={copy}
              className="press min-h-9 shrink-0 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-footnote text-label-2">Shown once. Treat it like a password.</p>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
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
          className="press mt-4 flex h-11 w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint disabled:opacity-60"
        >
          {busy ? "Connecting" : "Connect"}
        </button>
      )}
      {result && "error" in result ? <p className="mt-2 text-footnote text-danger">{result.error}</p> : null}
    </section>
  );
}
