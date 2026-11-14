"use client";

import { useState } from "react";

/** Connect Claude in one step: copy one URL, paste it into claude.ai, tap Allow. */
export function ConnectClaude({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the URL is selectable below.
    }
  }

  return (
    <section
      aria-label="Connect Claude"
      className="mt-5 flex flex-col gap-3 rounded-card bg-fill px-4 pt-3.5 pb-4"
    >
      <div>
        <p className="text-title3 font-semibold tracking-[-0.01em]">Connect Claude</p>
        <p className="text-subhead text-label-2">
          Ask Claude about your day and let it book your own blocks. About a minute.
        </p>
      </div>
      <ol className="list-decimal pl-5 text-subhead text-label-2">
        <li>Copy the link below.</li>
        <li>
          In Claude, open Settings, Connectors,{" "}
          <b className="font-semibold text-label">Add custom connector</b>, name it Michael and paste.
        </li>
        <li>Tap Allow. Claude can then read your day and add to it.</li>
      </ol>
      <div className="flex items-center gap-2 rounded-group bg-bg py-1.5 pr-1.5 pl-3">
        <code className="min-w-0 flex-1 truncate text-footnote select-all">{url}</code>
        <button
          type="button"
          onClick={copy}
          className="press min-h-9 shrink-0 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </section>
  );
}
