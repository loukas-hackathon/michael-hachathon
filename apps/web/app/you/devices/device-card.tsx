"use client";

import { useState } from "react";
import { createDeviceKey, type KeyResult } from "./actions";

type Props = {
  title: string;
  body: string;
  keyName: string;
  // What to copy: the bare key, or a full webhook URL built from it.
  copy: (r: { secret: string; webhookBase: string }) => string;
  steps: string[];
};

export function DeviceCard({ title, body, keyName, copy, steps }: Props) {
  const [result, setResult] = useState<KeyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const value = result && "secret" in result ? copy(result) : null;

  return (
    <section className="rounded-group bg-fill px-4 py-4">
      <p className="text-body font-semibold">{title}</p>
      <p className="mt-1 text-subhead text-label-2">{body}</p>
      {value ? (
        <>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            }}
            className="press mt-3 flex h-11 w-full items-center justify-center rounded-group bg-tint text-body font-semibold text-on-tint"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-subhead text-label-2">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="mt-2 text-footnote text-label-2">Shown once. Treat it like a password.</p>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setResult(await createDeviceKey(keyName));
            setBusy(false);
          }}
          className="press mt-3 flex h-11 w-full items-center justify-center rounded-group bg-tint text-body font-semibold text-on-tint disabled:opacity-60"
        >
          {busy ? "Creating" : "Connect"}
        </button>
      )}
      {result && "error" in result ? <p className="mt-2 text-footnote text-danger">{result.error}</p> : null}
    </section>
  );
}
