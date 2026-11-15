"use client";

import type { SetupConnection } from "@michael/shared";
import { type ReactNode, useEffect, useState } from "react";
import { createSetupLink, type LinkResult } from "@/lib/setup-actions";

// Small building blocks shared by the one tap setup components (#120).

/** Which device this page is open on. Null until mounted, so the server render stays neutral. */
export function useDevice(): "iphone" | "mac" | "other" | null {
  const [device, setDevice] = useState<"iphone" | "mac" | "other" | null>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    // iPadOS reports itself as a Mac; touch points tell them apart.
    if (/iPhone|iPod/.test(ua)) setDevice("iphone");
    else if (/Macintosh/.test(ua) && navigator.maxTouchPoints < 2) setDevice("mac");
    else setDevice("other");
  }, []);
  return device;
}

/**
 * Tab scoped memory for the setup page a QR code opened. iOS may reload the tab after a jump into
 * another app, and the setup token works once, so what it became is kept until the tab closes.
 * Only used on that page; signed-in pages simply make a new key.
 */
export const tabMemory = {
  get(name: string): string | null {
    try {
      return sessionStorage.getItem(`michael-setup-${name}`);
    } catch {
      return null;
    }
  },
  set(name: string, value: string) {
    try {
      sessionStorage.setItem(`michael-setup-${name}`, value);
    } catch {
      // Private mode or storage blocked: the page still works while it stays open.
    }
  },
};

export function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-group bg-fill px-4 py-4">{children}</section>;
}

/** A numbered step: done ones fade, the current one is full strength. */
export function Step({ n, done, children }: { n: number; done?: boolean; children: ReactNode }) {
  return (
    <li className={`flex gap-3 ${done ? "text-label-2" : ""}`}>
      <span
        className={`grid size-6 shrink-0 place-items-center rounded-full text-footnote font-semibold tnum ${
          done ? "bg-bg text-label-2" : "bg-tint text-on-tint"
        }`}
        aria-hidden="true"
      >
        {done ? (
          <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true">
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          n
        )}
      </span>
      <div className="min-w-0 flex-1 text-subhead">{children}</div>
    </li>
  );
}

export function PrimaryButton({
  children,
  busy,
  disabled,
  onClick,
}: {
  children: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className="press mt-2 flex h-11 w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press mt-2 flex h-11 w-full items-center justify-center rounded-full bg-bg text-body font-semibold text-tint-text"
    >
      {children}
    </button>
  );
}

/** A value to copy, with its Copy button. Selectable as a fallback when the clipboard is blocked. */
export function CopyRow({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2 rounded-group bg-bg py-1.5 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate text-footnote select-all">{value}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            // Clipboard blocked: the value is selectable.
          }
        }}
        className="hit press min-h-9 shrink-0 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint"
      >
        {copied ? "Copied" : label}
      </button>
    </div>
  );
}

export function ErrorLine({ text }: { text: string | null }) {
  return text ? <p className="mt-2 text-footnote text-danger">{text}</p> : null;
}

/**
 * From a computer: one tap makes a QR code. The iPhone camera opens the setup page with a setup
 * token that works once, for 30 minutes, and the steps continue there. `after` shows once the code
 * is up: the live first data check, so the laptop turns to Connected when the phone is done.
 */
export function QrHandoff({
  connection,
  what,
  after,
}: {
  connection: SetupConnection;
  what: string;
  after?: ReactNode;
}) {
  const [link, setLink] = useState<LinkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = link && "qrSvg" in link ? link : null;
  return (
    <Card>
      <p className="text-body font-semibold">Set up on your iPhone</p>
      <p className="mt-1 text-subhead text-label-2">{what}</p>
      {ok ? (
        <div className="mt-4 flex flex-col items-center">
          {/* biome-ignore lint/performance/noImgElement: an inline SVG data URL, nothing to optimise */}
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(ok.qrSvg)}`}
            alt="QR code that opens Michael's setup page on your iPhone"
            className="size-48 rounded-group bg-white p-2"
          />
          <p className="mt-3 text-center text-footnote text-label-2">
            Point your iPhone camera at it and tap the link. It works once, for 30 minutes.
          </p>
          <div className="w-full">{after}</div>
        </div>
      ) : (
        <PrimaryButton
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setLink(await createSetupLink(connection));
            setBusy(false);
          }}
        >
          {busy ? "Making your code" : "Show the code"}
        </PrimaryButton>
      )}
      <ErrorLine text={link && "error" in link ? link.error : null} />
    </Card>
  );
}
