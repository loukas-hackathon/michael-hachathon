"use client";

import { useState } from "react";

const CLAUDE_CONNECTORS = "https://claude.ai/settings/connectors";

function useCopy(url: string) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the link is selectable next to the button.
    }
  }
  return { copied, copy };
}

const TINTED = "bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] text-tint-text";

function LinkField({ url, primary, surface = "bg-bg" }: { url: string; primary: boolean; surface?: string }) {
  const { copied, copy } = useCopy(url);
  return (
    <div className={`flex items-center gap-2 rounded-group py-1.5 pr-1.5 pl-3 ${surface}`}>
      <code className="min-w-0 flex-1 truncate text-footnote select-all">{url}</code>
      <button
        type="button"
        onClick={copy}
        aria-live="polite"
        className={`hit press min-h-9 min-w-[88px] shrink-0 rounded-full px-4 text-subhead font-semibold ${
          primary ? "bg-tint text-on-tint" : TINTED
        }`}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

function Step({
  n,
  last,
  title,
  children,
}: {
  n: number;
  last?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {last ? null : (
        <span aria-hidden="true" className="absolute top-7 bottom-1 left-[11.5px] w-px bg-separator" />
      )}
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full bg-label text-footnote font-bold text-bg tnum"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        <p className="text-body font-semibold">{title}</p>
        {children}
      </div>
    </li>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 256 256" aria-hidden="true" className="mt-px size-5 shrink-0 text-label">
      <path
        d="m40 144 56 56L216 72"
        fill="none"
        stroke="currentColor"
        strokeWidth="20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const CAN = [
  "Read your day and your goals",
  "Tell you your score and where the time went",
  "Book focus blocks on your own calendar",
];

/**
 * Connect Claude, the hero of an empty Agents screen: three steps (copy the link, add it in
 * Claude, tap Allow) and what Claude can then do. `primary` gives Copy the one filled button;
 * it is tinted when an approval above already holds that place.
 */
export function ConnectClaude({ url, primary = true }: { url: string; primary?: boolean }) {
  return (
    <>
      <section
        id="connect-claude"
        aria-label="Connect Claude"
        className="mt-5 flex flex-col gap-4 rounded-card bg-fill px-4 pt-4 pb-5"
      >
        <div>
          <h2 className="text-title3 font-bold">Connect Claude</h2>
          <p className="mt-0.5 text-subhead text-label-2">
            Ask Claude about your day and let it book your own blocks. About a minute.
          </p>
        </div>
        <ol>
          <Step n={1} title="Copy your link">
            <LinkField url={url} primary={primary} />
          </Step>
          <Step n={2} title="Add it in Claude">
            <p className="text-subhead text-label-2">
              Settings, Connectors, <b className="font-semibold text-label">Add custom connector</b>. Name it
              Michael and paste the link.
            </p>
            <div>
              <a
                href={CLAUDE_CONNECTORS}
                target="_blank"
                rel="noreferrer"
                className={`hit press inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full px-4 text-subhead font-semibold ${TINTED}`}
              >
                Open Claude connectors
                <svg viewBox="0 0 256 256" aria-hidden="true" className="size-4">
                  <path
                    d="M72 184 184 72m-88 0h88v88"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="22"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            </div>
          </Step>
          <Step n={3} last title="Tap Allow">
            <p className="text-subhead text-label-2">
              I ask you once, here in Michael. Then Claude shows up on this screen.
            </p>
          </Step>
        </ol>
      </section>

      <section aria-label="What Claude can do" className="mt-6">
        <h2 className="mb-2 text-title3 font-bold">Once connected, Claude can</h2>
        <ul className="overflow-hidden rounded-group bg-fill">
          {CAN.map((line, i) => (
            <li key={line} className="relative flex items-start gap-3 px-4 py-[11px]">
              {i > 0 ? <span className="absolute inset-x-0 top-0 ml-12 h-[0.5px] bg-separator" /> : null}
              <Check />
              <span className="text-body">{line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 px-4 text-footnote text-label-2">
          It never touches events with other people, never deletes and never sends in your name. You choose
          what it sees, and every question it asks shows here.
        </p>
      </section>
    </>
  );
}

/** Once Claude is connected: the same link, for another account or device, out of the way. */
export function ConnectLink({ url }: { url: string }) {
  return (
    <section id="connect-claude" aria-label="Your connection link" className="mt-8">
      <h2 className="mb-2 text-title3 font-bold">Connect another AI tool</h2>
      <LinkField url={url} primary={false} surface="bg-fill" />
      <p className="mt-2 px-4 text-footnote text-label-2">
        Paste it as a custom connector in Claude on another account. Each new tool asks you here first.
      </p>
    </section>
  );
}

/** You > Claude: one link to copy and one line on where it goes. */
export function ClaudeLink({ url }: { url: string }) {
  return (
    <section aria-label="Your Claude link">
      <LinkField url={url} primary surface="bg-fill" />
      <p className="mt-2 px-4 text-footnote text-label-2">
        In Claude, open{" "}
        <a href={CLAUDE_CONNECTORS} target="_blank" rel="noreferrer" className="font-semibold text-tint-text">
          Connectors
        </a>
        , add a custom connector, paste it and tap Allow.
      </p>
    </section>
  );
}
