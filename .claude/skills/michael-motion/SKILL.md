---

name: michael-motion
description: Apple-like motion rules for Michael's web app. Use whenever you write or change UI in apps/web that moves, appears, disappears or responds to touch, such as transitions, animations, press states, sheets, list inserts or removals, toggles, chat bubbles, number changes, skeletons, or anything touching prefers-reduced-motion or the motion tokens in globals.css.
---

# Michael motion

Michael should feel like an app Apple shipped: motion that is quick, physical, interruptible and
always explains what changed. These rules sit under `docs/design-guide.md` ("Motion"); if the
two disagree, the design guide wins. Brand is locked: motion never adds colour, glow, gradients
or new brand elements, and **tab switches have no motion at all**.

## 1. When to animate

Animate only when it answers "what just happened?" or "where did it go?":

- Feedback on a touch (press, toggle, selection).
- Something arriving or leaving because of what the user did (a bubble, a row, a dismissed card).
- A state change in place (Done, Undone, a value that moved).
- Presentation of a sheet, and its dismissal.

Do not animate:

- Page loads, sections scrolling into view, or the content already there on mount (no
  fade-up-on-every-section; it reads as generated). Content is visible by default.
- Tab switches, the tab bar, headers, or anything the user does many times a minute.
- Keyboard-driven actions, focus moves, typing.
- Decoration: no loops, pulses or attention-seeking motion. The only loops allowed are the
  skeleton breath and the push-to-talk listening ring, both stopped by reduced motion.

## 2. Tokens (apps/web/app/globals.css)

Never write a literal duration or curve. Pair each spring with its own duration token.

| Token pair                               | Use                                                  |
| ---------------------------------------- | ---------------------------------------------------- |
| `--m-dur-press` + `--m-ease-out`         | Press in (120ms)                                     |
| `--m-dur-ui` + `--m-ease-out`            | Small interface changes, colour on small controls    |
| `--m-dur-exit` + `--m-ease-out`          | Leaving (200ms); exits are quicker than entrances    |
| `--m-dur-spring` + `--m-spring`          | Release, pops, arrivals, settle back (slight bounce) |
| `--m-dur-smooth` + `--m-spring-smooth`   | Things that slide across: knob, pill (no bounce)     |
| `--m-dur-sheet(-out)` + `--m-ease-sheet` | Sheets: 500ms in, 360ms out                          |
| `--m-dur-count` + `--m-ease-out`         | Score count up, once per session                     |

The springs are SwiftUI's `spring(response:dampingFraction:)` step response sampled into CSS
`linear()` (24 points, cut where it is within 0.4% of rest). `--m-spring` is response 0.4,
damping 0.8; `--m-spring-smooth` is response 0.35, damping 1 (SwiftUI's `.default` and `.smooth`
are critically damped too). Browsers without `linear()` fall back to `--m-ease-out` through
`@supports`. To add a spring, sample `x(t) = 1 - e^(-ζωt)(cos ω_d t + ζω/ω_d sin ω_d t)` with
`ω = 2π/response`, `ω_d = ω√(1-ζ²)`, and add a duration token equal to the settle time. Keep
bounce at or under 0.2 for interface; Michael is calm.

## 3. Patterns (use the class, do not reinvent)

- **Press:** `.press` on anything tappable: `scale(.97)` in fast, back on the spring. It works
  on `:active`, so a quick tap reverses mid flight. Segments in a segmented control dim
  (`active:opacity-60`) instead of scaling. Tab bar uses `.m-tab` (#203).
- **Arrivals:** `.m-pop-in`: opacity 0 and `scale(.96)` with 4px rise, on the spring, grown from
  where it comes from via `--m-origin` (user bubble `100% 100%`, Michael's bubble `0 100%`).
  Never scale from 0. Only for items that arrived after mount: wrap with `useArrival()` from
  `components/motion.ts` (`arriving(key) ? "m-pop-in" : ""`).
- **Departures:** `.m-leave` (fade and `scale(.97)`, 200ms, no spring), then unmount on
  `animationend` (see `components/today/recommendation-list.tsx`). Keep the optimistic state;
  roll back by removing the class.
- **In place changes:** `.m-swap` fades in a status line that replaced a button ("Done. Undo
  until 09:00."). Text changes, layout does not jump.
- **Switches:** `.m-switch` (or the native `<input switch>`): knob slides on the smooth spring
  and stretches to `scaleX(1.22)` under the finger; the track colour changes in 200ms.
- **Segmented control:** one pill (`.m-seg-thumb`) slides with `translateX`, never by moving
  the background between segments.
- **Sheets:** `components/sheet.tsx` only. Slides up on the sheet curve, dims the page, 360ms
  out. Dragging follows the finger 1:1 down and with 1/6 friction up; release past 120px or
  0.5px/ms closes from where it is, otherwise it settles back on the spring.
- **Numbers:** a headline number counts up once per session (`.m-count`, CSS `@property`, the
  real value always in the DOM). Later changes swap in place with `tabular-nums`; no slot reels,
  no count up on every refresh.
- **Live data:** things that arrived since the last look use `.m-live-enter` (#203).
- **Skeletons:** `components/skeleton.tsx`: blank for 200ms, then a slow opacity breath, final
  layout, real titles. No shimmer gradients, no spinners. Loading, pending, success and error
  states follow the `michael-feedback` skill.

## 4. Durations

- Touch feedback 100 to 150ms. Interface changes 150 to 250ms. Anything over 300ms must be a
  spring or a sheet (they feel done well before they settle).
- Exits are faster than entrances. Stagger at most 2 or 3 items, 40ms apart, never a list.

## 5. Reduced motion (`prefers-reduced-motion: reduce`)

Every new animation gets a reduced block in the same change. Rule: nothing moves or scales;
opacity only, 200ms linear, or instant. Springs become no transition. Loops stop. Inline styles
set from JS (drag settle) check `matchMedia("(prefers-reduced-motion: reduce)")` first.

## 6. Performance and craft

- Animate `transform` and `opacity` only (colour on small controls is the one exception).
  Never `transition: all`; never animate `width`, `height`, `top`, `left`, `margin`, or blur.
- No layout reads in animation loops; no JS animation where CSS works (CSS, then WAAPI, then JS).
- Set `transform-origin` to where the motion starts. Use `will-change` only while dragging.
- Motion must be interruptible: prefer transitions (they retarget) over keyframes for anything
  the user can reverse. No animation blocks input.
- View Transitions: not for tabs. Same-document only, for a shared element on a detail push if
  ever needed; snapshots are not interactive while they run and Safari support starts at 18.
- Never gate content on motion: if the animation does not run, the final state must be right.

## 7. Checklist before the PR

1. Does each animation answer "what happened?" Remove the ones that do not.
2. Tokens only; spring paired with its duration; no literals, no `transition: all`.
3. Only `transform`/`opacity` animate; nothing on mount or on tab switch.
4. Interrupt it: tap twice fast, drag and release halfway. It reverses smoothly.
5. Reduced motion on: no movement, content correct.
6. Record it at 390x844 in light and dark (Playwright `recordVideo` or frame screenshots), and
   look at the frames. Colours and logo unchanged.
7. `pnpm check` is green.

## Sources

- Apple HIG, Motion: https://developer.apple.com/design/human-interface-guidelines/motion
- SwiftUI `Animation.default` (response 0.55, damping 1):
  https://developer.apple.com/documentation/swiftui/animation/default
- Spring to `linear()` maths and caveats: https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function/linear,
  https://www.joshwcomeau.com/animation/linear-timing-function/
- View Transition API: https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- Vercel Web Interface Guidelines (animation, touch, performance):
  https://github.com/vercel-labs/web-interface-guidelines
- Emil Kowalski, "Great animations" and "7 practical animation tips":
  https://emilkowal.ski/ui/great-animations, https://emilkowal.ski/ui/7-practical-animation-tips
- Anthropic skills, frontend-design (motion only for user actions, one orchestrated moment):
  https://github.com/anthropics/skills/tree/main/skills/frontend-design
