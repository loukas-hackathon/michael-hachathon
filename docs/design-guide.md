# Michael design guide

What Michael looks like and how it behaves. Every agent working in `apps/web` follows this file.
It wins over `docs/interface-research.md`, which lists what to avoid; read both. Approved by Manolis
on Saturday 14 November. The visual version is the moodboard:
https://claude.ai/artifact/5gngx7giT3LGAKLDctTtVj

## The idea in one line

Apple's bones, the charts of our two references (bklit.com and efferd.com/blocks/dashboard), and one
pink that only ever means goal time.

## Principles

1. **If Apple shipped it, would it look like this?** Large titles, inset grouped lists, a floating
   tab bar, sheets for detail, system font, Apple's greys, light and dark from the phone.
2. **Pink means goal time and nothing else.** Everything else is black, white and grey. Lost time is
   grey and hatched, never red or clay.
3. **The number is the first word of a sentence.** Every screen has one headline number at most, and
   the sentence around it says what it means. No stat tiles, no rows of KPIs with arrows.
4. **Show the evidence next to the claim.** Michael's finding comes with the strip, block or chart
   that proves it, and with the one fix he made and how to undo it.
5. **True and specific.** Real or clearly marked sample data. Never an invented number shown as the
   user's. Copy from the Build Hub voice sheet, as written.

## The signature: the tape

Michael has watched the tape of your day, so time is drawn as tape. It is the outline and fill idea
at its smallest scale.

- One tick is 5 minutes of planned goal time.
- **Spent:** a filled pink tick (`--m-spark`).
- **Lost:** a grey tick at 45% height, dropped to the baseline (`--m-label-2`, 75% opacity).
- **Still ahead:** an outline tick, 1px `--m-label-2` stroke, no fill.
- Ticks are grouped by block with a wider gap between blocks. A `now` marker (1.5px `--m-label`
  line with a small time label) sits at the boundary between past and ahead.
- The score is this strip written as a number: spent divided by planned so far.

Where the tape appears:

| Place        | Form                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Today        | One horizontal strip under the score, full content width, ticks 30px tall                                                                      |
| Timeline     | Vertical: planned blocks are dashed outlines, spent time fills them pink, interruptions cut the block's right edge, lost stretches are hatched |
| Goals        | Coarser: one notch per 30 minutes of the weekly budget, with a black pace tick                                                                 |
| Watch, stage | The Today strip, small, under the number                                                                                                       |

Never draw goal time as rings, donuts or dials. They read as Apple's Activity rings and hide when the
time went.

## Colour

Locked on the Build Hub ("Colour and type"). Use the CSS variables, never literals.

| Token           | Light     | Dark      | Use                                                           |
| --------------- | --------- | --------- | ------------------------------------------------------------- |
| `--m-bg`        | `#FFFFFF` | `#000000` | Every screen                                                  |
| `--m-fill`      | `#F2F2F7` | `#1C1C1E` | Inset groups, Michael's card, fields                          |
| `--m-separator` | `#C6C6C8` | `#38383A` | Hairlines between rows (0.5px)                                |
| `--m-label`     | `#000000` | `#FFFFFF` | Text, logo, the `now` marker                                  |
| `--m-label-2`   | `#6C6C70` | `#98989F` | Secondary text, units, lost time, outlines                    |
| `--m-context`   | `#D1D1D6` | `#3A3A3C` | Context bars in charts (days that are not today, other goals) |
| `--m-spark`     | `#FF2E93` | `#FF2E93` | Goal time as a shape: ticks, fills, bars. Never small text    |
| `--m-tint`      | `#E6007A` | `#E6007A` | Filled buttons (white text), selected tab                     |
| `--m-tint-text` | `#B80062` | `#FF4FA3` | Pink text and links (AA on `--m-fill` and tinted buttons)     |
| `--m-danger`    | `#FF3B30` | `#FF453A` | Errors only                                                   |

- Text on a pink fill is black (about 6:1). White on `--m-spark` fails contrast.
- At most one pink element competes for attention on a screen; the tape counts as one.
- No gradients anywhere. Texture is allowed only as data: hatching for lost time, dots for sleep.

## Type

Inside the app, the system font. Outside the app (slides, film, website, brand pages), Mulish.

| Role        | Face         | Size / line | Weight | Notes                                |
| ----------- | ------------ | ----------- | ------ | ------------------------------------ |
| Score       | `ui-rounded` | 76 / 70     | 800    | Tabular, tracking -0.02em            |
| Large title | system       | 34 / 41     | 700    | The screen title                     |
| Insight     | system       | 22 / 27     | 400    | Grey, numbers in 600 and `--m-label` |
| Title 3     | system       | 20 / 25     | 700    | Section headings                     |
| Headline    | system       | 17 / 22     | 600    | Row titles                           |
| Body        | system       | 17 / 22     | 400    |                                      |
| Subhead     | system       | 15 / 20     | 400    | Michael's fix, nudges                |
| Footnote    | system       | 13 / 18     | 400    | Meta lines                           |
| Chart label | system       | 11 / 13     | 500    | Tabular, `--m-label-2`               |

- System stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", var(--font-figtree), system-ui, sans-serif`.
  Figtree (via `next/font`) is only the fallback for devices without SF Pro.
- `tabular-nums` on every number that changes or is compared.
- Section headings are sentence case. No small uppercase labels above headings.
- Never ship Apple's font files or SF Symbols; the system provides the font, icons are our own.

## Space, radius, elevation

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 44. Screen margin 16. Between groups 24. Inside a group 12.
- Radius: 2 for ticks, 7 for timeline blocks and bars, 12 for inset groups, 16 for Michael's card,
  capsule for buttons, scope chips and the tab bar.
- Elevation: groups sit on `--m-fill` with no border and no shadow. Only floating things (tab bar,
  sheets) get a shadow, and only with a tight blur. Never a border and a soft wide shadow together.
- Blur only on the floating tab bar and sheet backdrops, as on iOS.

## Components

| Component      | Spec                                                                                                                                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screen header  | Date or context line (13, 600, `--m-label-2`) with the Mi button right; large title below                                                                                                                                                                                              |
| Mi button      | 30px black circle with the white Mi monogram. Opens the You sheet. Off the record: hollow (1.5px ring)                                                                                                                                                                                 |
| Tab bar        | Floating capsule, 60px tall, 14px from the sides and 16px plus the safe area from the bottom. Four tabs: Today, Timeline, Goals, Chat. Our own icons at 24px. Selected uses `--m-tint-text`. A quiet black dot on Chat while Michael's check in waits (no number, no red). Never hides |
| Inset group    | `--m-fill`, radius 12, rows 11px by 16px, 0.5px separators inset 16px from the left                                                                                                                                                                                                    |
| Michael's card | `--m-fill`, radius 16, padding 14 by 16: Mi + "Michael" + time, insight, evidence, fix, one action                                                                                                                                                                                     |
| Buttons        | Capsule, 36px min height (44px hit area). Filled: `--m-tint` with white. Tinted: 14% tint background with `--m-tint-text`. Plain: text only. Press scales to 0.97                                                                                                                      |
| Scope chip     | Capsule on `--m-bg`, 13/18 600                                                                                                                                                                                                                                                         |
| Sheet          | Bottom sheet with grabber, one job, swipe to dismiss (Base UI Drawer)                                                                                                                                                                                                                  |
| Undo line      | Inline under the thing that changed, never a toast: "Moved. Undo until 19:00."                                                                                                                                                                                                         |

Icons: our own four tab icons (tape, timeline, notches, chat bubble), then Phosphor regular for anything
else, at 17, 20 or 24px. No icons in tinted rounded squares.

## Screens

Each screen ships five states: loading (a skeleton in the final layout, no spinner before 300ms),
empty, sparse, dense and error. Empty states say what will appear and give one next action.

### Today

Header "Wednesday 11 November" + Mi. Large title changes with the moment: Morning, Today, Evening.

1. Week line: "We're at 64% of goal time this week. Thursday decides it."
2. Score: "82%" then "of your goal time so far." (evening: "today").
3. The tape, with a key: "3h 33 spent · 47 min lost · 50 min ahead".
4. "47 minutes won back today." (the number in `--m-tint-text`).
5. Michael's card: one finding with its evidence strip, the fix he already made, one action (usually
   the undo).
6. Latest nudge as one row.

Morning leads with the plan, midday with a correction, evening with the verdict.
Empty: "Nothing yet. Wear the watch tonight and your first brief arrives in the morning."

### Timeline

Header "November" + Mi, title "Timeline", a week strip (M to S, today in a black circle).

- Collapsed sleep row with a dot texture: "Sleep 00:40 to 07:20 · 6h 40".
- Hours down the left in 11px labels with 0.5px rules. 50px per hour on phone.
- A thin black bar left of a block for calendar events with other people.
- Goal blocks: dashed outline for the plan, pink fill for time spent, interruptions as cuts on the
  right edge, lost stretches hatched with a label ("Instagram 19 min"). Labels inside in black.
- Other activity: grey blocks on `--m-fill`.
- Phone sessions as short grey ticks down the right edge.
- `now` rule across the day with a black time pill.
- Michael's moves shown in place: "I moved the end to 15:41" in `--m-tint-text` under a pink dashed
  extension.
- Tap a block: a sheet with the block's detail and a Bklit style tooltip timeline.

### Goals

Title "Goals", context "Wednesday. 4 days to go.", sorted furthest behind first.

- One row per goal: name, "1h 20 of 6h", the notched track (one notch per 30 minutes, black pace
  tick), seven thin day columns (today pink, other days `--m-context`, future days as small outlines),
  and a meta line: "Behind pace. 4h 40 left."
- "The maths" group when goals compete: the sentence ("These three need 16h 10 more this week. You
  have 12h free. Which one gives?") and a labelled split bar with a pink free time marker.
- Sleep sits in its own group outside the score, with a dashed goal line.

### Chat

Title "Chat". Michael's check in opens the screen when he has questions about the day (Brand's copy
in #189): one question at a time, the time or the number first, quick answers as chips (1 to 5, or
Yes and No) and an "Or in your own words" field. A no after a short night brings one follow up with
its number, never a why. At most five questions. It ends on "Noted. I'll use it in tomorrow's
plan." and "That's all for today. Sleep well." Below it, the free chat with Michael and push to
talk. Michael's goal and plan proposals appear as a card with Accept and Undo (#188).

### The You sheet (Mi button)

Agents first (a row into /agents, with a back link to You), then off the record (one switch),
standing instructions (quiet hours from the profile first, then the user's rules with a switch
each), sources with one switch each, devices, settings. Off the record turns the Mi hollow and adds a grey line on every tab: "Off the
record since 15:20."

### Agents (under the Mi button)

A back link to You, title "Agents", line "Who asked about you today: Claude, twice. Availability and recovery only."

- A new agent's request on top in a card: "Cursor wants to know when you're in deep work", scope
  chips, then Allow once (filled), Always (tinted), No (plain).
- "Allowed": one row per agent with its scopes and last question time.
- "Today": every question, time, agent, the question in plain words, Shared or Not shared.

### Onboarding

A five minute talk with Michael in the voice sheet's seven steps, then the three promises, then one
consent switch per source. One question per screen, large type, the Mi as the speaker.

### Desktop

The same components in an Efferd style bordered grid with a sidebar for the four tabs. Desktop only
has to be presentable; never design phone screens from it.

## Data views

Follow "Showing time on a phone" in `docs/interface-research.md`, plus:

- Hand written SVG. Marks are thin, data ends are rounded (2 to 4px), bars start at zero.
- Grey for context, pink for the goal time that matters, black for markers.
- Direct labels, no legends unless there are two or more series. Units in labels ("3h 10").
- Tooltips follow Bklit: date header, dot rows with tabular values, a rule, an optional annotation.
  Crosshair lines have small diamond caps. The current time is a black pill.
- Dense data (phone sessions per hour, day columns) uses many thin bars at low contrast over a grid
  that is barely there, as Efferd does.
- Phone check cadence: the headline says it ("every 21 minutes"), one strip of ticks proves it, with
  one typical gap bracketed.
- Heatmaps (days by hours over four weeks) use grey to black, never a colour ramp.

## Motion

Tokens live in `apps/web/app/globals.css` as CSS variables; use them, never literals. The full
rules, the springs' derivation and a checklist are in the agent skill
`.claude/skills/michael-motion/SKILL.md`.

| Token                   | Value                                        | Use                                          |
| ----------------------- | -------------------------------------------- | -------------------------------------------- |
| `--m-ease-out`          | `cubic-bezier(.23, 1, .32, 1)`               | Default for anything without a spring        |
| `--m-ease-sheet`        | `cubic-bezier(.32, .72, 0, 1)`               | Sheets                                       |
| `--m-spring`            | SwiftUI response 0.4, damping 0.8 (~1.5%)    | Press release, pops, arrivals, sheet settle  |
| `--m-spring-smooth`     | SwiftUI response 0.35, damping 1 (no bounce) | Things that slide: switch knob, segment pill |
| `--m-dur-press`         | 120ms                                        | Press in                                     |
| `--m-dur-ui`            | 200ms                                        | Interface changes, colour on small controls  |
| `--m-dur-exit`          | 200ms                                        | Something leaving                            |
| `--m-dur-enter`         | 420ms                                        | Something new arriving (live refresh)        |
| `--m-dur-spring`        | 480ms                                        | Always with `--m-spring`                     |
| `--m-dur-smooth`        | 430ms                                        | Always with `--m-spring-smooth`              |
| `--m-dur-sheet`, `-out` | 500ms in, 360ms out                          | Sheets                                       |
| `--m-dur-count`         | 700ms                                        | Score count up                               |

| What                       | How                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| Press on anything tappable | `.press`: `scale(.97)` in 120ms, back on `--m-spring`. Primary (filled) buttons also give a haptic tick   |
| Tab bar press              | Icon to `scale(.86)` and the tab to 60% opacity; the newly selected icon settles on `--m-spring`          |
| Tab switches               | None. The tab bar never moves                                                                             |
| Interface changes          | 200ms, `--m-ease-out`; a status line that changes in place fades in (`.m-swap`)                           |
| Arrivals                   | `.m-pop-in` from 0.96, from where it comes from (`--m-origin`); only items new since mount (`useArrival`) |
| Departures                 | `.m-leave`, 200ms, then unmount                                                                           |
| Switches, segmented        | Knob and pill slide on `--m-spring-smooth`; the knob stretches under the finger                           |
| Sheets                     | 500ms in on `--m-ease-sheet`, 360ms out; a short drag settles back on `--m-spring`                        |
| Score count up             | Once per session, 700ms, no bounce, after the splash. The real number is always in the DOM                |
| Live refresh               | New blocks rise 6px and fade in; a tape tick that just filled grows from the baseline                     |
| Loading                    | Skeleton in the final layout (`loading.tsx` per route): blank for 200ms, then a slow 1.6s breath          |
| Reduced motion             | Instant, opacity only: no transforms, no count up, skeletons still                                        |

Animate `transform` and `opacity` only. Content is visible by default; motion never gates it.

## Copy

The Build Hub voice sheet is the source; paste its lines as written. British spelling, 24 hour time,
numbers first ("47 minutes", above two hours "2h 15"), no emoji, no exclamation marks, no dashes,
never "productivity", "optimise" or "wellness". "I" for what Michael did, "we" for shared effort.
Buttons say the action and keep the word ("Undo until 09:00", then "Undone").

## Don'ts

- Rings, donuts, dials, radial gauges.
- KPI tile rows, up and down arrows with percentages, "Welcome back" greetings.
- Gradients, glow, glass on anything but the tab bar.
- Cards inside cards, coloured side stripes, icons in tinted squares, pulsing dots.
- Their fonts (Geist, Outfit, Cal Sans) or Inter in the app.
- Pink for errors, warnings or decoration.
- A desktop layout squeezed onto the phone.

## Check before merge

For every screen you touch:

1. Screenshots at 360, 390 and 430 wide and at desktop, in light and dark. Look at them.
2. Loading, empty, sparse, dense and error states exist and are designed.
3. Hold it against the tells table in `docs/interface-research.md` and this file's don'ts. Say in
   the PR which ones you checked.
4. Every number is real or marked sample data. Copy matches the voice sheet.
5. Touch targets are 44px, inputs 16px, nothing depends on hover.
6. `pnpm check` is green.
