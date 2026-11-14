# Telegram (nudges)

A backup channel for nudges, next to Web Push. Telegram mirrors its notifications to the Apple
Watch, so the stage moment still buzzes if Web Push does not. Contract: `docs/api.md`, "Telegram".

## One time setup (a human with Telegram, 3 minutes)

1. In Telegram search `@BotFather` (blue tick), tap **Start**.
2. Send `/newbot`. Name: `Michael`. Username: something free ending in `bot`, for example
   `michael_coach_bot`.
3. BotFather replies with a token like `123456789:AAE...`. Keep it secret.
4. Optional, in BotFather: `/setuserpic` (the logo), `/setdescription` ("Michael, your coach.
   Nudges only, at most five a day."), `/setcommands` with `stop - Stop nudges here`.

## Configuration

Railway, service `api`:

| Variable                  | Value                                                                       |
| ------------------------- | --------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`      | the token from BotFather (required)                                         |
| `TELEGRAM_BOT_USERNAME`   | the username without `@` (optional: asked from Telegram with `getMe`)       |
| `TELEGRAM_WEBHOOK_SECRET` | optional: any 1 to 256 of `A-Z a-z 0-9 _ -`; default derived from the token |
| `PUBLIC_API_URL`          | already set; must be https for the webhook                                  |

On every start the API calls `setWebhook` with `${PUBLIC_API_URL}/v1/webhooks/telegram` and the
secret (the logs say `[telegram] webhook set to ...`). Nothing to run by hand. Locally, without an
https URL, the webhook is skipped; use a tunnel and set `PUBLIC_API_URL` to it to try the bot.

Without `TELEGRAM_BOT_TOKEN` the You screen says Telegram is not set up yet and nothing else
changes.

## For the user

You > Nudges > **Connect Telegram**. Telegram opens the bot; tap **Start**. The bot answers
"Connected. I'll keep it short." From then on every nudge (and **Send a test**) also arrives in
that chat. **Disconnect** on You, or `/stop` in the chat, ends it. Each link works once and for 15
minutes.

## Checking it

- `GET /v1/telegram` shows `enabled` and `connected`.
- Telegram's view of the webhook:
  `curl https://api.telegram.org/bot<token>/getWebhookInfo` (look at `url` and `last_error_message`).
