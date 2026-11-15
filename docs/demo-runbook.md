# Demo runbook

The checklist before Michael goes on stage. The script is `docs/pitch.md`. With the real iPhone,
watch and laptop in hand, run the 15 minute pass in `docs/demo-dry-run.md` first (it also lists
what is not wired for the real devices, Omi in particular). The API key is on the
Build Hub; put it in your shell first and never paste it into a chat:

```bash
read -rs MICHAEL_API_KEY && export MICHAEL_API_KEY
API=https://api-production-16521a26.up.railway.app
WEB=https://michael-zeta-sand.vercel.app
```

**One account everywhere.** The pitch runs on the demo account (the demo week). The laptop browser,
the stage iPhone's Home Screen app and the claude.ai connector must all act as it, or the watch,
the stage and Claude will each see a different day.

## T minus 60 minutes

- [ ] **Production is the build we rehearsed.**
      `curl -s $API/health` shows `"status":"ok"`, `"storage":"supabase"` and a `commit` equal to
      `git rev-parse --short origin/main`. Freeze merges (label open PRs `wip`) until after the pitch.
- [ ] **Reseed the demo week** (refreshes the seven days up to now, resets goals and standing
      instructions to the plan, puts the daily ritual and logged time back to the plan, clears
      visitor chat, turns off the record off; never touches anything that is not a demo row):
      `curl -s -X POST -H "Authorization: Bearer $MICHAEL_API_KEY" $API/v1/demo/reseed`
      Expect `days` ending today and `goals_written` above 0.
- [ ] **No sample text on the stage** (#330). The reseed removes the sample brief ("Written by
      gemini (mock)"), the sample suggestions ("Add a protein snack before the gym") and the
      weight goal, and rewrites the follow up drafts:
      `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $MICHAEL_API_KEY" $API/v1/analysis/latest`
      prints `404` (or `200` once someone has asked for a real brief on Today), and
      `curl -s -H "Authorization: Bearer $MICHAEL_API_KEY" $API/v1/recommendations | grep -c -i "protein\|recovery is"`
      prints `0`. On Today, "Michael's brief" reads "None yet. I start with the ..." (the week's
      biggest loss, e.g. "the 2h 32 Instagram took this week")
      and Follow ups shows no line about seeding a demo week.
- [ ] **Book works on a Sunday.** The plan's only standing instruction is "Never book 23:00 to
      07:00" (it follows the sleep goal). "Keep Sundays clear" made Book and Do it refuse all
      Sunday with "No free 90 minutes left this week"; it must not be back:
      `curl -s -H "Authorization: Bearer $MICHAEL_API_KEY" $API/v1/instructions` lists that one
      rule. Then on **Goals** tap **Book 1h 30** on University: a block lands this evening (after the
      20:00 finalists slot, before 23:00). Tap **Undo** so the stage starts clean. If it still
      refuses, reseed again: the reseed replaces the instructions with the plan's.
- [ ] **Presenter key is set, in both places.** Not set at the Sunday 06:40 rehearsal: the consent
      page said "The presenter link is not switched on for this deployment yet." Loukas:
      `docs/setup-manual.md` step 2b, the same `DEMO_PRESENTER_KEY` on Vercel (then Redeploy) and on
      Railway, and the link on the Build Hub. Without it there is no Claude beat and Off the record
      refuses on stage.
- [ ] **Laptop browser in the demo week, as the presenter.** Open the presenter link from the Build
      Hub, `$WEB/auth/presenter?key=...`, in the laptop browser you present from (the one signed in
      to claude.ai). It signs out any Google session there and opens the demo week; the cookie lasts
      3 days, so once per laptop is enough. Today shows a score, not "Nothing yet". (A wrong key
      just opens the demo week.) Check: You > **Off the record** switches on ("Nothing is being
      collected since HH:MM.") and off again. "This is the demo week. Sign in with Google to make it
      yours." under it means this browser is not the presenter (or the API is older than #335).
- [ ] **Claude can talk.** In `$WEB/chat` send `How is my day going?`. A reply means
      `ANTHROPIC_API_KEY` works on Railway; "not set up" or a 503 means it is missing or out of credit.
- [ ] **Push is configured.** `curl -s -H "Authorization: Bearer $MICHAEL_API_KEY" $API/v1/push`
      returns `"enabled":true` (VAPID keys are on Railway). `devices` counts subscribed devices.
- [ ] **Stage iPhone subscribed.** Open Michael from the iPhone **Home Screen** (not Safari; push
      only works in the installed app). On the login page tap **See the demo week**. Then Mi (top
      right), **You > Nudges > Turn on nudges**, allow notifications, tap **Send a test**. The phone
      shows it. Run the `/v1/push` check again: `devices` is at least 1.
- [ ] **Telegram fallback.** You > Telegram reads Connected. The stage's N sends to Telegram as
      well as push, so the Telegram app on the stage iPhone, with notifications on, buzzes the watch
      even when web push does not. The N status line counts both, for example "Sent to 2 of 2 devices".
- [ ] **Watch mirrors it.** iPhone Watch app > Notifications > Michael (or the Home Screen app's
      entry): **Mirror my iPhone alerts**. Lock the iPhone, press **Send a test** from the laptop
      (You > Nudges) and feel the buzz.
- [ ] **claude.ai connector on the demo account: one tap.** Demo visitors cannot connect (it grants
      full write on the shared account); the presenter link above can.

      1. claude.ai > Settings > Connectors. If a `Michael` connector already exists, open it and
         **Disconnect** or remove it.
      2. **Add custom connector**: name `Michael`, URL `$API/mcp`
         (`https://api-production-16521a26.up.railway.app/mcp`; nothing in Advanced settings).
         **Add**, then **Connect**.
      3. A Michael tab opens: "Allow Claude to read and change your day?", and at the bottom
         "Signed in as the demo week (presenter)". Tap **Allow**. claude.ai finishes connecting.
         It says "This is the demo week" with no Allow instead? This browser is not the presenter:
         open the presenter link in it, then reload that tab (the request lasts 30 minutes).
      4. Check it worked: in a throwaway chat, Michael switched on in the tools menu, ask
         `Use Michael. What are my goals?`; the answer lists the demo goals. Then open
         `$WEB/agents`: Claude is listed under **What they can do**, and the line at the top says
         "Claude asked about you 1 today".

      Without a browser, the connector's server side can be checked end to end:
      `curl -s -o /dev/null -w '%{http_code}\n' -X POST $API/mcp` prints `401`, and
      `curl -s $API/.well-known/oauth-protected-resource/mcp` names `$API/mcp` as the resource.
      Last resort only (presenter link broken and no time to fix it)[^curl].

- [ ] **Google Calendar**, only if you also show a real account: Google Testing mode expires refresh
      tokens after 7 days. You > Sources > Google Calendar: if it says reconnect, tap it and pick the
      account. (The demo week has no Google connection; its calendar is generated.)
- [ ] **Voice conversation, on the laptop.** `$WEB/chat`, tap the wave button (**Talk to
      Michael**), allow the microphone (never let that prompt appear on stage), say "How is my day
      going?", hear the answer, tap **End**. The pitch runs voice on the laptop in Chrome (browser
      speech recognition, shown on the projector).
- [ ] **Voice on the iPhone, only as the fallback.** Open `$WEB/chat` in **Safari**, not from the
      Home Screen icon: the installed app has no browser speech recognition and depends on the
      ElevenLabs key having **Speech to Text** switched on (ElevenLabs > API keys > the key >
      permissions: Speech to Text on; `docs/setup-manual.md` step 10). With it on, hold the mic in
      the Home Screen app: the words appear about a second after you let go. "Tap the mic on your
      keyboard" means the toggle is off: use Safari.

## T minus 15 minutes

- [ ] Reseed once more (command above) so "now" on the tape is fresh and the evening log is open
      again (a rehearsal's Log the day stays logged until the reseed). Undo any focus block left
      from rehearsal first, on Today or Timeline: reseed never removes blocks Claude booked, and
      Timeline blocks you added stay until you delete them (tap the block, **Delete this block**).
- [ ] **Pick the focus block slot.** On Today (or Timeline), find a free 45 minutes later today that
      does not overlap any event with other people, has not started and ends by 23:00 ("Never book
      23:00 to 07:00"). Sunday evening: 21:15 (the finalists slot, 20:00 to 21:00, has
      other people). Write `HH:MM` on a card for the Claude prompt; the drag beat moves it 30 minutes
      later, so leave room after it.
- [ ] **Off the record is off** (You: the switch is grey). On, it stops nudges.
- [ ] **Focus modes off** on iPhone and watch: no Do Not Disturb, no Sleep, no Work focus. Watch
      silent mode off, haptics strong, wrist detection on, watch unlocked and on the wrist.
- [ ] **Laptop:** notifications silenced (macOS Focus on is fine here), display mirrored, zoom 125%
      for the phone screens, battery charged, on the venue Wi-Fi with a phone hotspot ready.
- [ ] **Tabs, in this order** (all `$WEB` unless noted): 1. `/stage` (full screen on the projector;
      `?theme=light` if the room is bright) 2. `/` Today 3. `/?ritual=evening` (the evening log,
      whatever the hour) 4. `/chat` (voice, and the fallback for the Claude beat) 5. claude.ai, new
      chat, Michael switched on in the tools menu 6. `/timeline` 7. `/you` 8. `/goals` (questions
      and fallback) 9. `/?demo=sample` (offline fallback, below)
- [ ] Press **N** once on `/stage` as a dry run: the watch buzzes and the projector shows the line.
      (Test nudges never count towards the five a day.)

## T minus 2 minutes

- [ ] iPhone locked, in a pocket, sound on. Watch on the wrist, screen awake.
- [ ] Laptop on tab 1, `/stage`, full screen. Keyboard focus inside the page (click it once) so N
      reaches it.
- [ ] claude.ai chat empty, cursor in the box, the booking prompt and the slot card at hand.
- [ ] Driver and speaker agree the cue for N ("That is Michael on my wrist").

## Offline fallbacks

| What fails                    | Do this                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| API down                      | `/?demo=sample`, `/goals?demo=sample`, `/agents?demo=sample`, `/stage?demo=sample`: fixtures, no API needed |
| Timeline                      | Always works: it renders Manolis' real anonymised days from the web app                                     |
| claude.ai connector           | Same request in `/chat` (Done chip with Undo), or Goals: Book 1h 30, then Undo                              |
| Chat answers 503              | `ANTHROPIC_API_KEY` missing on Railway: skip chat, use the claude.ai beat                                   |
| Watch does not buzz           | The projector still shows the nudge. Check iPhone locked, Focus off, `devices` above 0 in `/v1/push`        |
| Demo cookie expired           | Laptop: the presenter link again (3 days). iPhone Home Screen app: `$WEB/auth/demo` again (24 hours)        |
| Old numbers on Today          | Reseed, then refresh                                                                                        |
| Voice does not hear           | Type the ice bath line into `/chat` and press Send: same answer, no voice                                   |
| Evening log missing           | It was logged in rehearsal: read the logged card, reseed before the next run                                |
| Off the record says demo week | Not the presenter browser: do not tap again, say the privacy line over the screen                           |

## After the pitch

- Undo anything Claude booked, check Off the record is off, remove the `wip` labels.
- Update `status-now` on the Build Hub with what worked and what did not.

[^curl]: With the API key in the terminal, answer the consent by hand: copy the id after `request=`
in the Michael tab's address bar, run
`REQ=paste-the-id; curl -s -X POST -H "Authorization: Bearer $MICHAEL_API_KEY" -H "content-type: application/json" -d '{"allow":true}' $API/v1/connect/requests/$REQ`
and open the `redirect_to` URL it returns in the same tab within 5 minutes.
