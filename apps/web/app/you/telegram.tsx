import { getTelegram } from "@/lib/integrations";
import { disconnectTelegramChat, sendTelegramTest } from "./telegram-actions";

// Telegram on the You screen, a backup for nudges: one tap opens the bot with a one-time link,
// the user taps Start, done. Plain <a> for connect, so nothing prefetches a fresh token.
export async function TelegramRow() {
  const tg = await getTelegram();

  if (!tg?.enabled) {
    return (
      <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
        <span className="flex flex-col">
          <span className="text-body">Telegram</span>
          <span className="text-footnote text-label-2">Not set up on our side yet. Push still works.</span>
        </span>
        <span
          aria-disabled
          className="flex h-9 shrink-0 items-center text-subhead font-semibold text-label-2"
        >
          Soon
        </span>
      </div>
    );
  }

  if (!tg.connected) {
    return (
      <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
        <span className="flex flex-col">
          <span className="text-body">Telegram</span>
          <span className="text-footnote text-label-2">Nudges in a chat too. Tap Start in Telegram.</span>
        </span>
        <a
          href="/integrations/telegram/connect"
          className="press flex h-9 shrink-0 items-center rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint"
        >
          Connect Telegram
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-14 flex-col gap-2 px-4 py-2">
      <span className="flex flex-col">
        <span className="text-body">Telegram</span>
        <span className="text-footnote text-label-2">
          {tg.username ? `Connected as @${tg.username}.` : "Connected."} Nudges arrive there too.
        </span>
      </span>
      <span className="flex gap-4">
        <form action={sendTelegramTest}>
          <button type="submit" className="press h-9 text-subhead font-semibold text-tint-text">
            Send a test
          </button>
        </form>
        <form action={disconnectTelegramChat}>
          <button type="submit" className="press h-9 text-subhead font-semibold text-danger">
            Disconnect
          </button>
        </form>
      </span>
    </div>
  );
}
