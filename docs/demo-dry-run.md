# Demo dry run: the real devices in 15 minutes

One pass with the real iPhone, Apple Watch, Mac and the stage laptop, in pitch order.
It proves the hardware path for #28. The full checklist is `docs/demo-runbook.md`;
the words are `docs/pitch.md`. Run this first, then the runbook's T minus 15.

Two people. **Driver** on the laptop. **Speaker** wears the watch, iPhone in a pocket.
Tick each box. When a step fails, do its fallback, note it, and move on.
Write every failure on #28 afterwards.

Terminal on the laptop (the key is on the Build Hub; never paste it into a chat):

```bash
read -rs MICHAEL_API_KEY && export MICHAEL_API_KEY
API=https://api-production-16521a26.up.railway.app
WEB=https://michael-zeta-sand.vercel.app
```

## Part 1: before the pitch (5 minutes)

### Accounts and production (1 minute)

- [ ] `curl -s $API/health` shows `"status":"ok"`, `"storage":"supabase"`,
      and `commit` equals `git rev-parse --short origin/main`.
      If it fails: Railway dashboard, latest deploy logs. No API at all: Part 3.
- [ ] Reseed the demo week:
      `curl -s -X POST -H "Authorization: Bearer $MICHAEL_API_KEY" $API/v1/demo/reseed`
      Expect `days` ending today and `goals_written` above 0.
      If it fails: a 401 means the key in the shell is wrong. Copy it again from the Build Hub.
- [ ] `curl -s -H "Authorization: Bearer $MICHAEL_API_KEY" $API/v1/push`
      shows `"enabled":true`. Note `devices`.
      If `enabled` is false: VAPID keys are missing on Railway. The watch can only buzz
      through Telegram tonight (see Telegram below).

### Laptop (1 minute)

- [ ] Open the presenter link from the Build Hub in the browser you present from
      (the one signed in to claude.ai). Today shows a score, not "Nothing yet".
      If it says "The presenter link is not switched on for this deployment yet":
      `DEMO_PRESENTER_KEY` is missing (`docs/setup-manual.md` step 2b). No Claude beat,
      no Off the record on stage until it is set.
- [ ] You > **Off the record**: on ("Nothing is being collected since HH:MM."), then off.
      If it shows "This is the demo week. Sign in with Google to make it yours.":
      this browser is not the presenter. Open the presenter link again.
- [ ] Charger in, battery above 80%. On the venue Wi-Fi. Phone hotspot named and tested.
- [ ] macOS notifications silenced (Focus on is fine on the laptop only).
      Display mirrored to the projector, browser zoom 125%.

### iPhone (2 minutes)

- [ ] Battery above 60%, Low Power Mode off, on the venue Wi-Fi or mobile data.
- [ ] Control Centre: Focus **off** (no Do Not Disturb, no Sleep, no Work). Ring switch on.
- [ ] Open Michael from the **Home Screen** icon (not Safari: push only works in the
      installed app). If it shows the login page, tap **See the demo week**.
      If there is no icon: in Safari open `$WEB`, Share, **Add to Home Screen**, then open it.
- [ ] Mi (top right) > **You > Nudges > Turn on nudges**. Allow notifications.
      Tap **Send a test**. The iPhone shows it within 5 seconds.
      If the Allow prompt never appears: Settings > Notifications > Michael > Allow on.
- [ ] Run the `/v1/push` curl again: `devices` is at least 1.
- [ ] You > **Telegram** reads Connected, and the Telegram app on this iPhone has
      notifications on. This is the second way to the watch.
      If it is not connected: the demo account cannot link Telegram from the app
      (the presenter is refused). Link it from the terminal:
      `curl -s -X POST -H "Authorization: Bearer $MICHAEL_API_KEY" $API/v1/telegram/link`
      Open the returned `url` on the iPhone, tap **Start** in Telegram.
      A 503 means `TELEGRAM_BOT_TOKEN` is not on Railway: skip Telegram.

### Apple Watch (1 minute)

- [ ] On the wrist, unlocked, wrist detection on, battery above 50%.
- [ ] Watch Focus off and Silent Mode off. Settings > Sounds and Haptics: haptics strong.
- [ ] iPhone Watch app > Notifications: Michael (and Telegram) on **Mirror my iPhone alerts**.
- [ ] Lock the iPhone. Driver on the laptop: You > Nudges > **Send a test**.
      The watch buzzes within 10 seconds.
      If not: iPhone must be locked (an unlocked iPhone keeps the alert to itself),
      Focus off on both, `devices` above 0. Still nothing: rely on Telegram.

## Part 2: the live path, in pitch order (8 minutes)

Tabs on the laptop, in this order: `/stage`, `/`, `/?ritual=evening`, `/chat`,
claude.ai (new chat, Michael on in the tools menu), `/timeline`, `/you`, `/goals`,
`/?demo=sample`. All on `$WEB`.

| Beat                 | Screen              | Should take  |
| -------------------- | ------------------- | ------------ |
| 1. Stage             | `/stage`            | loads in 2 s |
| 2. Today             | `/`                 | 2 to 3 s     |
| 3. Evening log       | `/?ritual=evening`  | 3 to 8 s     |
| 4. Ice bath by voice | `/chat`             | 5 to 12 s    |
| 5. Claude books      | claude.ai, then `/` | 15 to 30 s   |
| 6. Drag              | `/timeline`         | 3 s          |
| 7. Watch buzz        | `/stage`, key N     | 2 to 10 s    |
| 8. Privacy           | `/you`              | 1 to 2 s     |

### 1. Stage

- [ ] Tab 1, full screen. Date, the big score (or "Your first block starts at HH:MM"),
      Michael's latest nudge, "Agents asking about me" along the bottom.
      If it fails: `/stage?demo=sample` (fixtures, no API).

### 2. Today

- [ ] Big number under "Optimisation score", seven day columns, the lost line
      ("4h 57 lost from your goal blocks this week" or similar).
- [ ] Tap **How I count**: Planned, Spent, Lost, Still ahead, Time won back. **Cancel**.
      If Today is empty or old: reseed, then refresh.

### 3. Evening log

- [ ] Tab 3. Three outcomes. **Partly** on the first, **Done** on the second,
      **Not** on the third, then **Log the day**.
      Reads "The day, logged. 1 of 3 done, 1 partly. 45 min logged for The company."
      If the card is missing: it was logged already. Reseed before the real run.

### 4. Ice bath by voice

- [ ] Tab 4. Tap the wave button (**Talk to Michael**). Allow the microphone now,
      never on stage. Say "I took an ice bath for 40 minutes after the ride."
      He answers aloud: "Logged 40 min. 70.3: ..." and a **Done. Undo until** chip.
      Tap **End**.
      If he does not hear: type the same line and **Send**.
      If chat says "not set up" or 503: `ANTHROPIC_API_KEY` on Railway. Skip the beat.
- [ ] Undo the ice bath with the chip so the real run starts clean.

### 5. Claude books the block

- [ ] Only once per laptop: the claude.ai connector, runbook "claude.ai connector" steps.
- [ ] Pick a free slot later today that ends by 23:00 and has no other people in it
      (Sunday evening: 21:15). In claude.ai type:
      `Use Michael. University is behind. Book me 45 minutes tonight at 21:15 called Statistics.`
      The answer ends with "undo until 21:15".
- [ ] Tab 2: the block is at the top, "Statistics, 21:15 to 22:00", with Undo.
      If Claude fails: tab 4, type `Book a 45 minute focus block today at 21:15 called Statistics`.
      If that fails too: `/goals`, **Book 1h 30** on University.

### 6. Drag it like Calendar

- [ ] Tab 6. Long press the Statistics block, drag 30 minutes down, let go.
      "Moved to 21:45." with **Undo**. Tap **Undo** ("Undone.").
      If there is no block: tap a free hour, type a title, **Add**, drag that.

### 7. The watch buzzes (the hardware moment)

- [ ] iPhone locked in the pocket. Tab 1, click the page once so N reaches it.
- [ ] Driver presses **N**. Within 10 seconds:
      projector shows the line with its reason underneath,
      status reads "Sent to 2 of 2 devices" (push and Telegram),
      the watch buzzes and shows the same line.
      Test nudges never count towards the five a day; pressing N in rehearsal is safe.
- [ ] Time it from N to buzz: **\_\_** seconds.
      If the projector says "Shown here. No device has nudges on.": nothing is subscribed.
      Redo the iPhone steps in Part 1.
      If it says "Sent to 1 of 2": one channel failed. The other still buzzes.
      If it says "Could not send. Check the API.": the API is down. Keep talking;
      "On a normal day that lands on the watch."
      Watch still: check the iPhone is locked and Focus is off, press N once more, no more.

### 8. Privacy

- [ ] Tab 7. **Off the record** on, then off again. Leave it **off**: on, it stops nudges.

### Clean up after the dry run

- [ ] Undo the Statistics block (Today or Timeline).
- [ ] Reseed again so the evening log is open for the real run.

## Part 3: if everything is down

Open `$WEB/?demo=sample`, `/goals?demo=sample`, `/agents?demo=sample`, `/stage?demo=sample`.
They render from fixtures with no API. Timeline always renders.
Say once: "Live link is down, so this is this morning's snapshot."
No Claude, no chat, no watch in that mode.

## Part 4: Omi and real watch data (optional, 2 minutes, not in the pitch)

The pitch uses the demo week, which replays watch data. The watch on stage is an output
(the buzz), not a live input. Only try this if there is time; it is not on the demo path.

### Omi conversation

What the code does: `POST /v1/webhooks/omi?key=...` keeps the summary and your own
commitments, never the transcript. It keeps a conversation **only** if Meetings mode was on
when the conversation started (#400). Otherwise it is accepted and dropped.

- [ ] In the Omi app: Apps, your private Michael app, External Integration,
      trigger **Conversation Creation**, webhook URL
      `$API/v1/webhooks/omi?key=<the API key>` (`docs/sources/omi.md`).
      The shared API key is the demo account, so it lands in the demo week.
- [ ] On the laptop (presenter): You > Privacy > **Meetings mode** > **Start**.
      First time: read the notice, **Start**. Reads "On since HH:MM."
- [ ] Wear Omi and talk for a minute. Say one commitment: "I will send them the pricing tomorrow."
- [ ] Wait. Omi sends the conversation only once it closes it after a silence,
      in the Omi app. Expect 1 to 3 minutes, not seconds.
- [ ] You > Privacy > Meetings mode > **End**. Today shows the meeting recap
      with your commitment; Timeline shows the conversation.
      If nothing arrives: check the Omi app shows the conversation as finished,
      Meetings mode was on before you started talking, and Off the record is off.
      Test the server side with the fixture: start Meetings mode first, and set the
      fixture's `started_at` to a time after you started it. Then:

```bash
curl -X POST "$API/v1/webhooks/omi?key=$MICHAEL_API_KEY" \
  -H "content-type: application/json" --data @apps/api/src/ingest/fixtures/omi.json
```

### Real Apple Watch data

- [ ] Only on a Google account, not the demo week: `docs/setup-manual.md` step 7
      (Health Auto Export). The setup page mints a device key, which the demo account
      cannot do.

## Not wired for the real devices (read before the pitch)

1. **Omi is not in the app.** There is no Omi row in You > Connections and no one tap
   connect. Setup is by hand in the Omi app with the shared API key in the URL.
   Ingest and Meetings mode are covered by tests with a fixture only; no real Omi
   device run is recorded in the repo. Keep Omi out of the pitch unless Part 4 passes.
2. **Omi needs Meetings mode on first.** Without it every conversation is dropped silently.
   Start it before speaking, end it after.
3. **Omi is not instant.** It sends after it closes the conversation, so "within a minute"
   from #28 depends on the Omi app, not on Michael.
4. **No live watch data on the demo account.** The demo week replays the watch.
   Health Auto Export needs a device key the demo account cannot mint.
5. **Telegram cannot be linked from the presenter browser.** `/v1/telegram/link` is not
   allowed for the demo account in the app. Link it with the curl in Part 1 if needed.
6. **The watch buzz is web push plus Telegram, nothing else.** ntfy in
   `docs/setup-manual.md` step 6 was never built; ignore it. Push works only from the
   Home Screen app, and the demo cookie there lasts 24 hours.
7. **Not checked from code:** that `DEMO_PRESENTER_KEY`, VAPID keys, `TELEGRAM_BOT_TOKEN`
   and `ANTHROPIC_API_KEY` are set on production. Part 1 checks each by hand.
