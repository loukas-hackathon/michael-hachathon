# Omi conversations

Omi (wearable and notetaker) sends each finished conversation to Michael. We keep the summary,
the category and the user's own commitments (Omi's action items). The transcript, other speakers'
words and their names are never stored. Raw audio never reaches us.

Build Hub rule: conversations are recorded only in a user started meetings mode with a consent
notice. That is the user's job in the Omi app; Michael only receives what Omi finished.

## Set up (in the Omi app, about three minutes)

1. Omi app, Apps, **Create an app**. Keep it private.
2. Capability **External Integration**, trigger **Conversation Creation** (older builds call it
   "Memory Creation").
3. Webhook URL:
   `https://api-production-16521a26.up.railway.app/v1/webhooks/omi?key=<your key>`
   Omi cannot send headers, so the key goes in the URL. Omi adds `&uid=...` itself; we ignore it.
   Until per-user ingest tokens exist (#114) the key is the shared `API_KEY`.
4. Install the app on your own account.

Do not point the real time transcript trigger at Michael: those batches are accepted and thrown
away.

## What lands on the timeline

One `conversation` event per conversation: title, summary, action items, duration. Re-sends are
safe (`external_id` = `omi:<id>`). Discarded conversations are skipped. Details: `docs/api.md`,
"Source webhooks". Sample body: `apps/api/src/ingest/fixtures/omi.json`.

## Try it

```sh
curl -X POST "$API/v1/webhooks/omi?key=$API_KEY" -H "content-type: application/json" \
  --data @apps/api/src/ingest/fixtures/omi.json
```
