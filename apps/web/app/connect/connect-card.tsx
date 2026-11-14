"use client";

import { useState } from "react";
import { type ConnectResult, createLink } from "./actions";

type Props = { title: string; body: string; tokenName: string; show: "url" | "secret"; steps: string[] };

// One card per thing to connect: one tap creates a personal link, one tap copies it.
export function ConnectCard({ title, body, tokenName, show, steps }: Props) {
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const value = result && "url" in result ? (show === "url" ? result.url : result.secret) : null;

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
            {copied ? "Copied" : "Copy link"}
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
            setResult(await createLink(tokenName));
            setBusy(false);
          }}
          className="press mt-3 flex h-11 w-full items-center justify-center rounded-group bg-tint text-body font-semibold text-on-tint disabled:opacity-60"
        >
          {busy ? "Creating" : "Create my link"}
        </button>
      )}
      {result && "error" in result ? <p className="mt-2 text-footnote text-danger">{result.error}</p> : null}
    </section>
  );
}
