"use client";

import { type ReactNode, useState } from "react";
import { telegramLink } from "@/app/you/telegram-actions";
import { TELEGRAM_CONNECT, telegramAppLink } from "@/lib/one-tap";
import { useStandalone } from "./standalone";

/**
 * "Connect Telegram". In a browser tab it is the plain redirect, as before. In the installed app,
 * which has no back button, t.me must not load in the app's own window: I fetch the one-time link
 * and hand it to the Telegram app (tg://), so Michael stays where it was. A plain <a>, so nothing
 * prefetches a fresh token.
 */
export function TelegramConnectLink({
  className,
  children,
  onOpen,
}: {
  className: string;
  children: ReactNode;
  /** Called on every tap, in a tab or the installed app (e.g. to start waiting for the chat). */
  onOpen?: () => void;
}) {
  const standalone = useStandalone();
  const [busy, setBusy] = useState(false);
  return (
    <a
      href={TELEGRAM_CONNECT}
      aria-busy={busy || undefined}
      className={`${className} ${busy ? "opacity-60" : ""}`}
      onClick={async (e) => {
        onOpen?.();
        if (!standalone) return;
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          const r = await telegramLink();
          const app = "url" in r ? telegramAppLink(r.url) : null;
          // No link (the API is down): the old redirect, which lands on You with the error line.
          window.location.href = app ?? TELEGRAM_CONNECT;
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </a>
  );
}
