# Interface research

How Michael's interface avoids looking generated, and how it feels like a native app on an iPhone.
Researched Saturday 14 November 2026 from two passes: the published catalogues of "AI slop" tells
and the craft sources behind them, and the best personal data apps plus the current platform docs.
Sources are at the end. Read this before any work in `apps/web`.

Manolis' own design and reference guide wins wherever it disagrees with this file.

## Three findings

1. **Our core screens are the named defaults.** A daily score is the "hero metric template": a big
   number, a small label, supporting stats and a gradient accent. Two independent rule sets name it
   as the default an AI reaches for. Four stat tiles, progress rings, gradient progress bars,
   coloured stripes on timeline items and status dots are all named too. The Today and Timeline
   screens are where we are most likely to look generated, so they need the most deliberate design.
2. **A ban list alone only moves the default.** When purple and Inter were banned, models drifted
   to a warm cream background with a serif and a terracotta accent, and to near black with one acid
   accent. Both are now recognised tells. The fix is a positive design derived from this product:
   what Michael is, who uses him, where and when.
3. **On mobile the craft rules matter more than the tells.** Almost nobody has catalogued mobile
   specific tells. Apple's guidelines and the interface guidelines from Vercel and Rauno Freiberg
   are the standard to check against.

## The tells

Each of these was named by several independent sources. If a screen shows one, redesign that part
rather than restyling it.

| Layer      | Tell                                                                                             | Do instead                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Colour     | Purple or indigo, purple to blue gradients                                                       | One brand hue from the product. Gradients off by default                                                   |
| Colour     | Near black with one neon accent and coloured glows                                               | Depth from surface steps and type. Shadows have an offset, never a halo                                    |
| Colour     | Warm cream background with a serif and a clay accent                                             | If a warm neutral stays, pair it with nothing from that cluster and make everything else unmistakably ours |
| Colour     | A different colour per card, status dots that mean nothing                                       | 3 to 5 colours in total, one accent per screen, every colour tied to a meaning                             |
| Colour     | Gradient text, gradient buttons, gradient progress fills, glowing borders                        | Solid fills. Emphasis comes from weight or size                                                            |
| Type       | One default face at default sizes, weak hierarchy                                                | A defined scale with obvious steps. Tuned tracking, numerals and weights                                   |
| Type       | Small uppercase tracked label above every heading                                                | Delete it. The heading carries it                                                                          |
| Type       | Everything centred                                                                               | Left aligned content in app screens                                                                        |
| Type       | Monospace for small data labels as a technical costume                                           | Tabular numerals in the main face                                                                          |
| Layout     | Hero metric: big number, small label, stat row, gradient                                         | A deliberate treatment for the score, with a reason for every part                                         |
| Layout     | Rows of identical cards, grids of stat tiles                                                     | Size and position by importance                                                                            |
| Layout     | Card inside card, every block in a rounded bordered box                                          | Group with space and type. Cards only for things you can act on                                            |
| Layout     | One radius on everything, very large radii, pills everywhere                                     | A small radius scale, nested radii concentric, pills only for small controls                               |
| Layout     | A coloured stripe down the left edge of a card or row                                            | Show state with fill, an icon and a label                                                                  |
| Layout     | A border and a wide soft shadow on the same element                                              | Declare elevation once: border or shadow                                                                   |
| Layout     | Landing page habits inside the app: taglines, explanatory notes, numbered markers                | A plain title, then the content                                                                            |
| Components | Untouched component library defaults                                                             | Retheme radius, colour, shadow and focus ring before building screens                                      |
| Components | Emoji as icons                                                                                   | Never                                                                                                      |
| Components | One default icon set at default stroke, icons in tinted rounded squares                          | One set, one weight, sizes 16, 20 or 24. Our own tab icons                                                 |
| Components | Badges and pills on everything, pulsing "live" dots                                              | Badges only for real state                                                                                 |
| Components | Glass and blur as decoration                                                                     | Blur only where the platform uses it: a floating tab bar or header                                         |
| Components | Progress rings, donuts and sparklines as filler                                                  | A chart only where its shape answers a question the user has                                               |
| Motion     | Fade and slide up on every section                                                               | Content visible by default. One authored moment per screen at most                                         |
| Motion     | Hover lift on every card, bouncy springs on routine actions                                      | Press feedback. Ease out. Springs only for gestures                                                        |
| Motion     | Pulsing dots, marquees, animated gradient backgrounds                                            | Remove                                                                                                     |
| Copy       | Hype words, exclamation marks, greeting filler                                                   | Michael's voice sheet. Numbers first                                                                       |
| Copy       | Text that explains an obvious element                                                            | If a label can be removed, remove it                                                                       |
| Copy       | "No data yet"                                                                                    | An empty state names what will appear and gives one next action                                            |
| Data       | Rainbow series colours, invented round numbers                                                   | Grey for context, the accent for the one thing that matters, real or clearly marked sample data            |
| Mobile     | A desktop layout stacked into one long column, a hamburger menu, centred modals                  | Phone first screens, a bottom tab bar, bottom sheets                                                       |
| Details    | No empty, loading or error states. Default selection colour, caret, focus ring and tap highlight | Design every state. Theme the browser's own surfaces                                                       |

Fonts are contested. Several lists ban Inter and other neutral faces, but those rules were written
for landing pages, and good products ship neutral faces. For an installed app the tell is untuned
type, not the family.

## Rules to check a screen against

**Type**

- At most two families. A set scale, and no size off it.
- Body text 17px on iPhone. Nothing under 11px. No weight under 400.
- Body line height 1.4 to 1.6. Prose lines 45 to 75 characters.
- `tabular-nums` on every number that changes or is compared: score, timers, budgets.
- Font weight never changes on press or selection.
- Headings use `text-wrap: balance`. Real ellipsis and curly quotes. A non-breaking space between a
  number and its unit.
- Negative tracking no tighter than -0.04em.

**Colour and depth**

- 3 to 5 colours in total. One accent per screen. The accent always means the same thing.
- Text contrast at least 4.5:1, large or bold text at least 3:1.
- No grey text on a coloured surface: tint it from that surface.
- One light source. Shadows have two layers and are tinted toward the background, never pure black.
- Status is never colour alone.

**Layout**

- All spacing from one scale (4, 8, 12, 16, 24, 32). Tight inside a group, generous between groups.
- Prefer space or a change of background to a border.
- Squint test: blurred, the first, second and third things on the screen are still in order.
- Design in greys first. Add colour last.

**Motion**

- Press feedback within 200ms. Interface animation under 300ms. Sheets up to 500ms.
- Sheets: `transform 0.5s cubic-bezier(0.32, 0.72, 0, 1)`, which matches iOS.
- Ease out for anything entering or leaving. Never ease in. Never `transition: all`.
- Buttons scale to 0.97 on press. Nothing animates from `scale(0)`: start at 0.9 with opacity.
- Animate `transform` and `opacity` only. Animations can be interrupted. Exit is faster than enter.
- No animation on actions repeated many times a day. Delight goes where use is rare.
- Honour `prefers-reduced-motion`. No transition when the theme changes.

**Touch**

- Every target at least 44 by 44, with space between neighbours.
- Hover styles only inside `@media (hover: hover)`. Nothing depends on hover.
- Inputs at 16px or more. Zoom is never disabled.
- The tab bar is for navigation only, always visible, labelled, and never hides a tab.
- Sheets: one at a time, with a grabber and swipe to dismiss. Successive sheets differ in height.

**States and copy**

- Every screen has designed empty, sparse, dense, loading and error states.
- Feedback appears next to what caused it: an inline tick, not a toast.
- Buttons name the action and keep the word ("Start block", then "Block started"). Errors say what
  went wrong and how to fix it, without apology.

## Patterns from the best apps

- **One number per screen, with one plain sentence under it.** Opal and Bevel lead with a single
  score. The sentence does the explaining: "3h 10 of the 4h 30 you planned went to your goals."
- **The headline is the finding, not the label.** Apple's own example: "Sales in the past 30 days
  totalled 1,234 pancakes", not "Sales in the past 30 days". For us: "Instagram cut your study
  block 7 times."
- **Detail lives one tap away.** Small charts on Today carry no grid, labels or interaction. A tap
  opens the full version, and the shape and numbers stay the same on the way in.
- **Very little colour, and it always means something.** Emphasise one thing and fade the rest to
  grey. For us the accent means goal time. Lost time is muted and hatched, not red.
- **Today works like the top story of a news app.** Oura changes its lead through the day. For us:
  the plan in the morning, a correction at midday, the verdict in the evening.
- **The coach interprets and gives one instruction.** One observation with a number, one
  instruction, one tap.
- **Compare people with themselves.** "38 minutes better than your usual Thursday."
- **Count the gain.** Time won back is a counter that only rises during the day.
- **A recommendation ends in a commitment.** One action button: "Start 45 minute block."
- **Sheets keep context and do one job.** Detail and coach actions open over Today and Timeline.
- **Animate only what changes, in the direction of travel.** The tab bar never moves.
- **Native behaviour, our own look.** Sheet physics, 44px targets and a pressed state on every
  control, in our type and colour.
- **Local first.** Cache the day, update optimistically, no spinner when switching tabs.
- **Dark for the hours of use, with a manual switch.** The stage demo happens in daylight.

## Showing time on a phone

For every chart: direct labels and no legend, units in the label ("3h 10", never 3.17 h), tabular
numerals, about four grid lines at round values, no axis lines, bars from zero, a sentence headline
above, a touch target as tall as the plot, and nothing critical hidden behind a touch. Hand written
SVG with a label that states the takeaway.

| Problem                                | Preferred                                                                                                                                                                                                                 | Fallback                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A day with many sources                | A vertical timeline: time flows down, hours in a left gutter, a narrow lane for sleep, workouts and calendar, a wide lane for what happened. Sleep and empty hours collapse to one row. A "now" rule. A tap opens a sheet | A 24 hour ribbon on Today with three or four thin rows, as a preview |
| Planned against actual                 | Outline against fill: planned blocks are dashed outlines, actual time fills them, the shortfall is the empty outline. In summaries a thick bar for actual with a thin tick for the plan                                   | One progress bar and a sentence                                      |
| Weekly budget per goal                 | One row per goal: the name, "5h 20 of 8h", a bar with a pace tick for today, seven small day columns. Sorted by furthest behind                                                                                           | A bar plus "2h 40 left, 3 days to go"                                |
| Many short interruptions in a block    | The block drawn solid with the interruptions cut in as thin ticks along one edge. A minimum tick width, merging by opacity when dense. Label: "7 interruptions, 23 minutes"                                               | A count on the block and a list in the sheet                         |
| A frequency such as "every 21 minutes" | Say it as the headline, then prove it with one strip of ticks across the waking day, with one typical gap bracketed and labelled                                                                                          | A histogram of gaps in five bins, the most common one in the accent  |

Do not use concentric rings for planned against actual: they read as Apple's Activity rings.

## Native feel on iPhone

Current platform: Safari 27 on iOS 27. Items marked "test on the phone" were not confirmed for iOS 27.

**Install and chrome**

- `app/manifest.ts` with `display: "standalone"`, `start_url`, `background_color`, `theme_color`,
  icons at 192 and 512. `app/apple-icon.png` at 180 by 180 with an opaque background.
- `metadata.appleWebApp = { capable: true, title: "Michael", statusBarStyle: "default" }`. Not
  `black-translucent`: it forces white status bar icons, unreadable on a light background. Test on
  the phone.
- `viewport.themeColor` as a light and dark pair, and the same colour on `html` and `body`.
- iOS builds no splash screen from the manifest. Without an `apple-touch-startup-image` for the
  device, launch is a white flash. Generate one for the demo iPhone.
- There is no install prompt on iOS. Show our own short instruction when not installed
  (`matchMedia("(display-mode: standalone)")`).
- Web push works only for an installed web app and only after a tap asks for permission.
- `navigator.wakeLock.request("screen")` keeps the screen awake on stage.

**Viewport and safe areas**

```ts
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
```

```css
.app {
  min-height: 100dvh;
} /* never 100vh */
.tabbar {
  position: fixed;
  inset: auto 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.scroller {
  padding-bottom: calc(64px + env(safe-area-inset-bottom));
}
.header {
  padding-top: env(safe-area-inset-top);
}
```

The keyboard changes no viewport unit on iOS. Use `window.visualViewport` to lift a composer above
it.

**Touch**

```css
html {
  -webkit-text-size-adjust: 100%;
}
body {
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
  overscroll-behavior-y: none;
}
button,
a,
[role="button"] {
  touch-action: manipulation;
}
input,
select,
textarea {
  font-size: 16px;
}
.sheet-scroll {
  overscroll-behavior: contain;
}
```

Tailwind's `hover:` already compiles to `@media (hover: hover)`.

**Navigation**

- View transitions need no configuration in the App Router. `import { ViewTransition } from "react"`,
  the same `name` on two elements for a morph, `<Link transitionTypes={["nav-forward"]}>` for
  direction. The wrapper goes in each `page.tsx`, never in the layout. The docs warn that some
  animations behave differently in Safari, so test on the phone.
- Required CSS: `::view-transition { pointer-events: none; }` and zero durations under reduced motion.
- Pin the tab bar with its own `viewTransitionName` and `animation: none`.
- The system back swipe carries no transition type. Keep the four tabs top level and open detail
  as sheets, so nothing competes with that gesture.
- To keep all four tabs alive with their scroll position, render them in one client shell with
  `<Activity mode="visible" | "hidden">`.

**Polish**

- `next/font` with a CSS variable, then `@theme inline { --font-sans: var(--font-body); }`.
- `@theme { --color-*: initial; }` removes Tailwind's stock palette, so no default colour can leak in.
- Dark at night follows the phone's appearance setting through `prefers-color-scheme`. Add a manual
  override with a `data-theme` attribute.
- There are no programmatic haptics on iOS. A real `<input type="checkbox" switch>` gives a native
  tick when tapped. Test on the phone.
- A spinner only after 150 to 300ms, shown for at least 300ms. Prefer optimistic updates and
  skeletons that mirror the final layout.
- Icons as inline SVG.

## Libraries

| Need             | Use                                                            | Why                                                                                       |
| ---------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Primitives       | Base UI                                                        | Unstyled, so nothing looks default                                                        |
| Bottom sheet     | Base UI Drawer                                                 | Swipe to dismiss, snap points, keyboard handling. Vaul is unmaintained                    |
| Motion           | CSS transitions, `@starting-style` and view transitions first  | Add Motion only for gesture driven animation                                              |
| Animated numbers | NumberFlow                                                     | Small, respects reduced motion, a visible payoff on the score                             |
| Charts           | Hand written SVG                                               | Everything we draw is bars, ticks and rectangles. A chart library looks like that library |
| Icons            | Phosphor in one weight, plus our own four tab icons and symbol | A default set at default stroke is recognisable                                           |
| Toasts           | An inline status line                                          | Feedback belongs next to its trigger                                                      |

Do not ship Apple's system fonts or symbols on the web: the licence does not allow it.

## Open decisions for Manolis

1. **The warm paper background.** Our provisional palette (paper `#F6F3EC`) sits in the cluster
   that two rule sets name as a current AI default (`#F4F1EA` with a serif and a clay accent). We
   avoid two of the three parts already (no serif, a green accent), and the "lost time" colour
   `#A4553A` is close to the third. Options: keep it and rely on type, layout and the data views to
   make it ours; move to a true off-white with a slight green tint; or commit to a stronger
   surface. The reference guide may settle this.
2. **How the score is shown.** A big number is right for the product and is also the most copied
   pattern. It needs a treatment that is specifically Michael's.
3. **Symbol, palette and font** are still to be picked by number on the Build Hub.

## Sources

Anthropic's frontend design skill and frontend aesthetics cookbook; Vercel's Web Interface
Guidelines; Rauno Freiberg's interface guidelines; the impeccable skill and its catalogue of tells;
Emil Kowalski's articles and published skill; Apple's Human Interface Guidelines (typography,
layout, sheets, tab bars, motion, charts); Benji Taylor's "Family Values"; Linear's design writing;
Josh Comeau on shadows and springs; Erik Kennedy's rules; Datawrapper on colour and text in charts;
Adrian Krebs' measurement of design patterns across 1,590 launch pages; the WebKit blog and Safari
release notes through Safari 27.2; web.dev on viewport units and web apps; the Next.js 16 guides on
web apps, view transitions and preserving state; the Tailwind v4 theme docs; the Base UI, NumberFlow
and Phosphor docs; and design posts from Oura, Opal, Bevel, Gentler Streak, Structured, Copilot
Money and Cultured Code.

Not verified: status bar behaviour and switch haptics on iOS 27, the system back swipe inside an
installed web app, and details of apps whose own pages did not load (WHOOP, Apple Screen Time,
Strava). The chart recommendations are our own, built on Apple's and Datawrapper's principles.
