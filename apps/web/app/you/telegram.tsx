import { ActionButton } from "@/components/action-button";
import { TelegramConnectLink } from "@/components/telegram-connect-link";
import { getTelegram } from "@/lib/integrations";
import { disconnectTelegramChat, sendTelegramTest } from "./telegram-actions";

// Telegram on the You screen, a backup for nudges: one tap opens the bot with a one-time link,
// the user taps Start, done. Plain <a> for connect, so nothing prefetches a fresh token.
export async function TelegramRow() {
  const tg = await getTelegram();

  if (!tg?.enabled) {
    return (
      <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
        <span className="flex min-w-0 flex-col">
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
        <span className="flex min-w-0 flex-col">
          <span className="text-body">Telegram</span>
          <span className="text-footnote text-label-2">Nudges in a chat too. Tap Start in Telegram.</span>
        </span>
        {/* Beside the app, so this page stays and flips by itself once you tap Start (#466). From the
            installed app it hands over to the Telegram app instead (#468). */}
        <TelegramConnectLink
          newTab
          className="hit press flex h-9 shrink-0 items-center rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint"
        >
          Connect
        </TelegramConnectLink>
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
      <span className="flex items-start gap-4">
        <ActionButton
          action={sendTelegramTest}
          label="Send a test"
          pendingLabel="Sending"
          className="hit press h-9 min-w-[5.5rem] text-left text-subhead font-semibold text-tint-text"
        />
        <ActionButton
          action={disconnectTelegramChat}
          label="Disconnect"
          pendingLabel="Disconnecting"
          className="hit press h-9 text-left text-subhead font-semibold text-danger"
        />
      </span>
    </div>
  );
}
