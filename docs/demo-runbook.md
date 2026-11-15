# Demo runbook

The checklist before Michael goes on stage. The script is `docs/pitch.md`. The API key is on the
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
      instructions to the plan, clears visitor chat, turns off the record off; never
      touches anything that is not a demo row):
      `curl -s -X POST -H "Authorization: Bearer $MICHAEL_API_KEY" $API/v1/demo/reseed`
      Expect `days` ending today and `goals_written` above 0.
- [ ] **No sample text on the stage** (#330). The reseed removes the sample brief ("Written by
      gemini (mock)"), the sample suggestions ("Add a protein snack before the gym") and the
      weight goal, and rewrites the follow up drafts:
      `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $MICHAEL_API_KEY" $API/v1/analysis/latest`
      prints `404` (or `200` once someone has asked for a real brief on Today), and
      `curl -s -H "Authorization: Bearer $MICHAEL_API_KEY" $API/v1/recommendations | grep -c -i "protein\|recovery is"`
      prints `0`. On Today, "Michael's brief" reads "I read your day and tell you what matters now."
      and Follow ups shows no line about seeding a demo week.
- [ ] **Book works on a Sunday.** The plan's only standing instruction is "Nothing between 23:00
      and 07:00" (it follows the sleep goal). "Keep Sundays clear" made Book and Do it refuse all
      Sunday with "No free 90 minutes left this week"; it must not be back:
      `curl -s -H "Authorization: Bearer $MICHAEL_API_KEY" $API/v1/instructions` lists that one
      rule. Then on **Goals** tap **Book time** on University: a block lands this evening (after the
      20:00 finalists slot, before 23:00). Tap **Undo** so the stage starts clean. If it still
      refuses, reseed again: the reseed replaces the instructions with the plan's.
- [ ] **Laptop browser in the demo week.** Open `$WEB/auth/demo` (the "See the demo week" button on
      the login page). The cookie lasts 24 hours. Today shows a score, not "Nothing yet".
- [ ] **Claude can talk.** In `$WEB/chat` send `How is my day going?`. A reply means
      `ANTHROPIC_API_KEY` works on Railway; "not set up" or a 503 means it is missing or out of credit.
- [ ] **Push is configured.** `curl -s -H "Authorization: Bearer $MICHAEL_API_KEY" $API/v1/push`
      returns `"enabled":true` (VAPID keys are on Railway). `devices` counts subscribed devices.
- [ ] **Stage iPhone subscribed.** Open Michael from the iPhone **Home Screen** (not Safari; push
      only works in the installed app). On the login page tap **See the demo week**. Then Mi (top
      right), **You > Nudges > Turn on nudges**, allow notifications, tap **Send a test**. The phone
      shows it. Run the `/v1/push` check again: `devices` is at least 1.
- [ ] **Watch mirrors it.** iPhone Watch app > Notifications > Michael (or the Home Screen app's
      entry): **Mirror my iPhone alerts**. Lock the iPhone, press **Send a test** from the laptop
      (You > Nudges) and feel the buzz.
- [ ] **claude.ai connector on the demo account.** The consent page refuses demo visitors ("This
      is the demo week. Sign in with Google to make it yours."), because connecting an agent grants
      it full write on the shared account. The presenter answers the consent with the API key, in
      the laptop browser you present from (the one signed in to claude.ai). 1. Open `$WEB/auth/demo` in that browser first. It signs out any Google session there (a
      session always wins over the demo week, and Claude would connect to that account instead). 2. claude.ai > Settings > Connectors. If a `Michael` connector already exists, open it and
      **Disconnect** or remove it. 3. **Add custom connector**: name `Michael`, URL
      `https://api-production-16521a26.up.railway.app/mcp` (the same as `$API/mcp`; nothing in
      Advanced settings). Tap **Add**, then **Connect**. 4. A Michael tab opens on the consent page, which says "This is the demo week". Do not sign in
      with Google (that connects your own account). Copy the id after `request=` in its address
      bar, then in the terminal (the key never leaves it):
      `REQ=paste-the-id; curl -s -X POST -H "Authorization: Bearer $MICHAEL_API_KEY" -H "content-type: application/json" -d '{"allow":true}' $API/v1/connect/requests/$REQ`
      It answers `{"redirect_to":"https://claude.ai/..."}`. Open that URL in the same browser
      tab within 5 minutes; claude.ai finishes connecting. If the request has expired, press
      Connect on claude.ai again. 5. Check it worked: in a throwaway chat, Michael switched on in the tools menu, ask
      `Use Michael. What are my goals?`; the answer lists the demo goals. Then open
      `$WEB/agents`: Claude is listed under **What they can do**, and the line at the top says
      "Claude asked about you 1 today".
      Without a browser, the connector's server side can be checked end to end:
      `curl -s -o /dev/null -w '%{http_code}\n' -X POST $API/mcp` prints `401`, and
      `curl -s $API/.well-known/oauth-protected-resource/mcp` names `$API/mcp` as the resource.
- [ ] **Google Calendar**, only if you also show a real account: Google Testing mode expires refresh
      tokens after 7 days. You > Sources > Google Calendar: if it says reconnect, tap it and pick the
      account. (The demo week has no Google connection; its calendar is generated.)
- [ ] **Voice** (only if PR #146 has merged): on the stage iPhone, `/chat`, hold the mic, say a line,
      hear the answer. Otherwise test Claude app voice mode with the Michael connector on.

## T minus 15 minutes

- [ ] Reseed once more (command above) so "now" on the tape is fresh. Undo any focus block left
      from rehearsal first: reseed never removes blocks Claude booked.
- [ ] **Pick the focus block slot.** On Today (or Timeline), find a free 45 minutes later today that
      does not overlap any event with other people and has not started. Write `HH:MM` on a card for
      the Claude prompt. A slot that has started, or overlaps a meeting, is refused.
- [ ] **Off the record is off** (You: the switch is grey). On, it stops nudges.
- [ ] **Focus modes off** on iPhone and watch: no Do Not Disturb, no Sleep, no Work focus. Watch
      silent mode off, haptics strong, wrist detection on, watch unlocked and on the wrist.
- [ ] **Laptop:** notifications silenced (macOS Focus on is fine here), display mirrored, zoom 125%
      for the phone screens, battery charged, on the venue Wi-Fi with a phone hotspot ready.
- [ ] **Tabs, in this order** (all `$WEB` unless noted): 1. `/stage` (full screen on the projector; `?theme=light` if the room is bright) 2. `/` Today 3. `/timeline` 4. `/goals` 5. claude.ai, new chat, Michael switched on in the tools menu 6. `/agents` 7. `/you` 8. `/chat` (fallback for the Claude beat) 9. `/?demo=sample` (offline fallback, below)
- [ ] Press **N** once on `/stage` as a dry run: the watch buzzes and the projector shows the line.
      (Test nudges never count towards the five a day.)

## T minus 2 minutes

- [ ] iPhone locked, in a pocket, sound on. Watch on the wrist, screen awake.
- [ ] Laptop on tab 1, `/stage`, full screen. Keyboard focus inside the page (click it once) so N
      reaches it.
- [ ] claude.ai chat empty, cursor in the box, the two prompts and the slot card at hand.
- [ ] Driver and speaker agree the cue for N ("That is Michael on my wrist").

## Offline fallbacks

| What fails           | Do this                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| API down             | `/?demo=sample`, `/goals?demo=sample`, `/agents?demo=sample`, `/stage?demo=sample`: fixtures, no API needed |
| Timeline             | Always works: it renders Manolis' real anonymised days from the web app                                     |
| claude.ai connector  | Same request in `/chat` (Done chip with Undo), or Today's "Michael suggests" card: Do it, then Undo         |
| Chat answers 503     | `ANTHROPIC_API_KEY` missing on Railway: skip chat, use the claude.ai beat                                   |
| Watch does not buzz  | The projector still shows the nudge. Check iPhone locked, Focus off, `devices` above 0 in `/v1/push`        |
| Demo cookie expired  | Open `$WEB/auth/demo` again (lasts 24 hours), on the laptop and in the iPhone Home Screen app               |
| Old numbers on Today | Reseed, then refresh                                                                                        |

## After the pitch

- Undo anything Claude booked, check Off the record is off, remove the `wip` labels.
- Update `status-now` on the Build Hub with what worked and what did not.
