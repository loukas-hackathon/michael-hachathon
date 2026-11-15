# Handoff: onboarding, voice and personal lines (Sun 15 Nov, Lucas's session)

Read this first if you are a new Claude session or account picking up this work. Also read
AGENTS.md, CLAUDE.md, and the Build Hub (link in CLAUDE.local.md; ask Lucas if it is missing).
On the Build Hub: notes `decision-onboarding-talk`, `decision-personal-not-generic`,
`decision-focus-auto-start`; tasks `onboarding-voice-talk`, `personal-everywhere`; findings
`onboarding-talk`, `personal-lines-ideas`.

## What Lucas asked for (decisions, all his)

- Onboarding is a talk with Michael, not a form. Michael speaks from the first tap. The calendar
  is optional and comes BEFORE the talk, so he can ask about the real week. Hands free
  conversation: he listens on his own, shows the user's words live, asks one natural follow up at
  a time (written by Claude). Type instead for noisy rooms, skip any question, fix misheard words.
  Goals come from what the user said, however messy; the user checks them before saving.
- Philosophy: get as much information as possible without tiring anyone; humane, never robotic.
- Onboarding is THE priority. Quality first, not speed.
- Michael never makes general descriptions: every line from the user's own data.
- Focus turns itself on when a synced goal block starts (once per block).
- Voice visuals must feel like Siri: living, audio reactive, humane.
- Every tap must answer at once (Michael visibly thinks); no frozen screens.
- Works on phone AND laptop.
- Ship as PR per piece with auto-merge (merging deploys). Hold a PR with the `wip` label until
  reviewed; Lucas wants a review on phone and laptop sizes, light and dark, before merge.
- Use online UI references: Anthropic frontend-design skill
  (github.com/anthropics/skills/tree/main/skills/frontend-design) and Vercel web interface
  guidelines (github.com/vercel-labs/web-interface-guidelines), under the repo's own skills
  (michael-ui, michael-motion, michael-feedback) and docs/design-guide.md.

## Shipped and live in production

| PR  | What |
| --- | --- |
| 511 | Onboarding talk v1, `POST /v1/goals/from-words`, focus auto-start, contract for the turn API |
| 518 | `POST /v1/onboarding/turn`: Michael's next line on the quick model (`ANTHROPIC_FAST_MODEL`, default the Haiku model), opener from calendar facts, script fallback |
| 521 | Word lists understand twice, weekdays, an hour and a half, a couple of hours |
| 522 | Today: every line from the user's own data |
| 529 | Hands free voice agent onboarding: intro voice, calendar first, live words, pause ends turn, laptop column; review fixes (You said ... Fix, startup and deep work one goal) |

Key files: apps/web/app/onboarding/{talk.tsx,page.tsx,frame.tsx,actions.ts,voice-orb.tsx},
apps/web/components/voice/{listen-turn.ts,speech.ts,recorder.ts},
apps/web/lib/onboarding-script.ts, apps/api/src/onboarding/turn.ts,
apps/api/src/goals/from-words.ts, apps/api/src/focus/session.ts (autoStartFocus),
apps/web/lib/today-lines.ts. Tests: e2e/tests/onboarding.spec.ts, onboarding-iphone.spec.ts.

## In flight when this was written (check GitHub for their state)

1. Branch `claude/onboarding-living-voice` (PR labelled `wip`): Siri like, audio reactive voice
   visual replacing the orb. Michael speaking driven by a Web Audio AnalyserNode on the ElevenLabs
   audio element (browser voice: word boundary beats), listening by mic level, a distinct thinking
   swirl, idle breath, muted still. Possibly also in chat's conversation sheet.
2. Branch `claude/onboarding-alive` (PR labelled `wip`): every onboarding tap answers at once with
   a visible thinking state (show delay about 200 ms, minimum about 400 ms), calm screen
   transitions, a Michael thinking loading screen instead of the goals skeleton, the hard black
   band behind the pinned "Go to Today" footer on the connect step fixed (soft fade), the dark mode
   planned goal bars that read as black lines fixed.

If either branch has no PR yet, finish it on that branch: run the checks below, open the PR with
`wip`, then review.

## How to review a held PR, then release it

1. Check out the PR head under a local name (`git checkout -b review-N origin/<branch>`).
2. `pnpm check`, `pnpm test`, then the e2e specs:
   `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-anon-key pnpm --filter @michael/web build`
   then `pnpm --filter @michael/e2e e2e tests/onboarding.spec.ts tests/onboarding-iphone.spec.ts tests/first-minute.spec.ts tests/email-sign-in.spec.ts --trace off`.
3. Screenshots with a throwaway Playwright spec in e2e/tests (delete it after): 390x844 and
   1440x900, light and dark. A demo visitor (`enterDemo`) sees the calendar screen: tap "Not now".
   Look for anything robotic, wordy, static or tiring; fix it on the branch.
4. Push fixes to the PR branch (no force push), remove the `wip` label, let auto-merge run.
5. After merge: production API `https://api-production-16521a26.up.railway.app/health` reports
   the deployed commit; web is https://michael-zeta-sand.vercel.app. Update the Build Hub.

## Next, once the in-flight work is merged

- Lucas to test on a real iPhone and laptop: Michael's voice plays, words appear, follow ups react
  to what was said (if every line sounds scripted, "Got it." each time, the model is not reaching
  production: check ANTHROPIC_API_KEY on Railway and the API logs for `[onboarding] model
  unavailable`).
- Personal lines beyond Today (Build Hub finding `personal-lines-ideas`): chat starters, morning
  and evening nudges, Telegram and push, watch row, score explanations, latest nudge outcome,
  connections, advice cards, week review, empty states. Lucas picks; suggested first: chat
  starters, nudges, watch row.
- Known gaps: the turn API's invented number check catches digits only, not number words; on
  iPhone the user's words show only after transcription (iOS limit); speaking over Michael does
  not cut him off (tap the orb).
- The stale branch `claude/onboarding-turn-api` (pre squash history) can be deleted.
