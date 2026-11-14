---

name: michael-feedback
description: Loading and feedback rules for Michael's web app (perceived performance). Use whenever you add or change a loading.tsx, a skeleton, a Suspense boundary, a server action call, a form, a button or switch that talks to the server, an optimistic update, an error line, a success line, or anything that refreshes data in apps/web.
---

# Michael feedback

Michael must feel like it is working cleanly and fast, even when the network is not. This skill
sits beside `michael-motion` (how things move) and under `docs/design-guide.md` (if they disagree,
the design guide wins). Brand is locked: feedback never adds colour, glow, gradients, toasts or new
brand elements. Audit of the current app: `docs/perceived-performance-audit.md`.

## The thresholds (why the numbers below)

| Wait         | What the user feels                       | What Michael shows                                                                         |
| ------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| under 100ms  | Instant, caused by them                   | The final state. Press state only                                                          |
| 100 to 300ms | A tiny lag, still instant if acknowledged | Optimistic result, or the button's pending label                                           |
| 300ms to 1s  | Notices the wait, keeps their thought     | Skeleton bones in place, or pending label                                                  |
| 1 to 10s     | Needs reassurance it is still going       | Skeleton breath plus a plain status line that changes                                      |
| over 10s     | Attention drifts                          | Steps ("Reading your day", "Writing the brief"), cancel or "I'll tell you when it's ready" |

Sources: Nielsen's 0.1 / 1 / 10 second limits; Doherty threshold (about 400ms) for system response.

## Rules

1. **Acknowledge every tap within 100ms.** `.press` gives touch feedback; anything that calls the
   server also changes visibly within 100ms: optimistic result, or the label becomes the pending verb
   ("Saving", "Syncing", "Sending"). The control is `disabled` and `aria-busy` while pending, so a
   double tap never sends twice.
2. **Optimistic by default for reversible, own-data actions** (switches, Done, Undo, Dismiss, Keep,
   scope toggles, instruction on/off). Show the result now, keep the previous state, roll back on
   failure with one line in Michael's voice. Use `useOptimistic` inside a transition, or local state
   with an explicit `before`. Guard rapid repeats per item (ignore or queue while one is in flight).
3. **Not optimistic** for: deleting data, disconnecting a source, anything with other people, and
   anything whose result only the server knows (the brief, a new key, address search). Those show
   pending in the button, then the real result in place.
4. **Every async action resolves to success or error, in place.** Success is a status line where
   the button was (`.m-swap`, `role="status"`): "Synced at 14:02.", "Sent. Check Telegram.". Error is
   one line under the control (`role="alert"`, `text-danger`): what happened plus what to do, "I
   could not reach the server. Nothing changed." Never a toast, never a silent no-op, never a stuck
   pending state: always clear pending in `finally`.
5. **No spinner before 300ms, ever; no spinner at all inside the app.** Waits under 300ms show
   nothing extra. Once a loading state appears it stays at least 300ms, so it never flashes.
   Skeletons already wait 150ms then breathe (`components/skeleton.tsx`); keep it.
6. **Skeletons mirror the real component's box model.** Same container, padding, radius, row heights,
   gaps and real titles; bones only where data lands. A skeleton belongs to its own route or
   component, never borrowed: a screen without its own `loading.tsx` inherits Today's, which is wrong.
   Build bones from the component's own spacing (share the class strings) so they cannot drift.
7. **No content jumps.** Reserve space for everything that loads late (fixed `min-h` on status lines,
   brief text, chart boxes, images with width and height). Swapping skeleton to content, pending to
   result, or one status line for another must not move anything below it. Check with the CLS
   overlay or by screenshot diff: target CLS 0.
8. **Progressive reveal, top down.** Header and title paint instantly (static), then the headline
   number, then the list, then the rest. Split slow reads into their own async components inside
   `<Suspense>` with a component-shaped fallback, so a slow block never holds the whole screen.
9. **Refreshes keep what is on screen.** `router.refresh()` and live updates run inside
   `startTransition`; the old content stays until the new content is ready, never a skeleton on a
   refresh. New items use `.m-live-enter`; removed items use `.m-leave`.
10. **Numbers change in place.** `tabular-nums` always, so width never jumps. A number the user just
    changed (goal minutes, score after Done) may tween over `--m-dur-ui`; a background refresh swaps
    it without motion; the headline counts up once per session only (`michael-motion`).
11. **Navigation answers at once.** Tab and day taps move the selection immediately (local state or
    `useLinkStatus`), while the destination's own `loading.tsx` or Suspense fallback covers the data.
    Links stay prefetched; `prefetch={false}` only for routes that redirect off site.
12. **Long work tells its steps.** Anything that may pass 2s (the brief, chat answers, Google sync)
    shows what it is doing in plain words and streams partial results when it can (chat already does).

## Copy for states

- Pending verbs, no ellipsis needed and no dashes: "Saving", "Syncing", "Sending", "Connecting",
  "Reading your day". Keep the button's width (`min-w` equal to the longer label).
- Success: past tense plus the fact, under 15 words: "Saved.", "Synced at 14:02.", "Sent to @name."
- Error: "I could not ... ." plus the next step. Admit it in one line. Never blame the user.

## Patterns (code)

- Server Component forms (`<form action={serverAction}>`): put the button in a small client
  component that reads `useFormStatus()` for pending, and return a result from the action so the row
  can show success or the error line. A bare form submit with no feedback is a bug.
- Sheet header Save buttons sit outside the form (`form={id}`), so `useFormStatus` cannot see them:
  pass `pending` from `useActionState` up to the button.
- Client calls: `setBusy(true); try { ... } finally { setBusy(false) }`. Catch to a Michael line.
- Delayed indicator: start a 300ms timer on pending; show the indicator only if still pending, then
  hold it at least 300ms.

## Checklist before the PR

1. Throttle to Slow 4G in devtools; tap every control you touched. Each one answers within 100ms.
2. Kill the API (or make the action throw): each control rolls back or shows an error line, and
   nothing stays pending.
3. Double tap fast: exactly one request.
4. Navigate to the screen cold: the skeleton matches the final layout (overlay screenshots at
   390x844); no element moves when data lands.
5. No spinner, no toast, no new colour; reduced motion still correct.
6. `pnpm check` is green.

## Sources

- Nielsen, response time limits: https://www.nngroup.com/articles/response-times-3-important-limits/
- Nielsen, progress indicators: https://www.uxtigers.com/post/progress-indicators
- Doherty threshold: https://lawsofux.com/doherty-threshold/
- Apple HIG, Loading and Progress indicators: https://developer.apple.com/design/human-interface-guidelines/loading,
  https://developer.apple.com/design/human-interface-guidelines/progress-indicators
- Apple HIG, Feedback: https://developer.apple.com/design/human-interface-guidelines/feedback
- Next.js 16 `loading.js`, `useLinkStatus`, streaming (bundled in `node_modules/next/dist/docs`)
- React `useOptimistic`, `useActionState`, `useFormStatus`: https://react.dev/reference/react/useOptimistic
- Delayed spinner and minimum display (300ms / 350ms): https://www.epicreact.dev/workshops/react-suspense/pending-flash
- Skeleton practice and CLS: https://web.dev/articles/cls, https://uxdesign.cc/what-you-should-know-about-skeleton-screens-a820c45a571a
- Inline feedback over toasts for button actions: https://uxmovement.substack.com/p/why-toasts-arent-the-best-for-button
