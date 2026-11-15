---

name: michael-ui
description: Detail rules for Michael's web app screens - no noise, one dynamic bar, Apple radius and focus rings, spacing, rows and numbers. Use whenever you add or change a screen, card, row, list, chart, progress or count indicator, button, chip, input, sheet, empty state or copy in apps/web, and before opening any apps/web UI PR.
---

# Michael UI

Every screen must be intuitive at a glance, with nothing that says nothing. This skill sits under
`docs/design-guide.md` (if they disagree, the guide wins) and beside `michael-motion` (how things
move) and `michael-feedback` (loading and results). Brand is locked: never change a colour token,
font or the logo, and pink still means goal time only.

## 1. No noise

Before anything ships, ask of each element: what question does the user have right now, and does
this answer it? If not, it goes.

- **No zeros as content.** A chart, meter or bar where every value is 0 or empty is not shown; the
  sentence says it ("Nothing lost from goal blocks yet.") and that is all. Same for "0 min" headline
  numbers, empty tapes, rows of empty notches and 0 of N bars that nobody can move yet.
- **One of everything.** No duplicated navigation (two date rows, two links to the same page), no
  heading that repeats the screen title, no section heading over a single row (fold the row into a
  neighbouring group), no number said twice on one screen.
- **Empty state = one line + one action.** Say what will appear, give the one tap that makes it
  appear. Never a card of filler ("I read your day and tell you what matters now") on an empty day.
- **Nothing you cannot use.** Disabled or Coming soon things are one quiet footnote line, not a row
  each with icons and descriptions.
- **Filler copy goes.** No "Here you can...", no explaining the obvious, no subtitle that restates
  the title. Numbers lead the sentence; units in the label.
- Lead with the answer. Detail folds away ("More from Michael"), and a fold with nothing in it hides.

## 2. One dynamic bar

Progress, counts and budgets are ONE continuous bar, never a row of blocks, notches, dots or
segments. Use `components/progress-bar.tsx`:

```tsx
<ProgressBar value={done / total} size="sm" label="Get started" valueText={`${done} of ${total}`} />
<ProgressBar value={firm} soft={spent} planned={booked} target={pace} tone="spark" label="..." />
```

- Rounded ends (capsule), track `--m-context`, fill slides on `transform` (`.m-bar-fill`, smooth
  spring, instant under reduced motion). Never animate `width`.
- `tone="spark"` (pink) only for goal time; counts, steps and connections use `label` (black).
- `target` draws the black tick (pace, floor, line to clear). `planned` is an outline for booked but
  not done. `soft` is the lighter fill for unconfirmed time.
- The number sits beside the bar in text (`tnum`), the bar has `label` and `valueText` for screen
  readers. `sm` (4px) for steps and counts, `md` (10px) for goal rows.
- Goals has its own `GoalBar` (`components/goals/goal-charts.tsx`, #309), the same rules.
- The tape (`components/tape.tsx`) is the same idea for a day: one strip whose runs (spent, lost
  hatched, ahead outlined) merge. A chart of separate days or hours (bars per day) is a chart, not
  progress, and keeps its columns.

## 3. Radius and focus

iOS-like scale, as tokens in `globals.css` (Tailwind `rounded-*`):

| Token             | px  | Use                                                 |
| ----------------- | --- | --------------------------------------------------- |
| `rounded-tick`    | 2   | Ticks, tiny marks                                   |
| `rounded-block`   | 7   | Timeline blocks                                     |
| `rounded-control` | 10  | Text buttons, fields, inputs, small pressable tiles |
| `rounded-group`   | 12  | Inset groups, rows that stand alone                 |
| `rounded-card`    | 16  | Michael's card, Get started                         |
| `rounded-sheet`   | 20  | Sheets (top corners)                                |
| `rounded-full`    |     | Filled and tinted buttons, chips, bars, the tab bar |

- Where the browser supports `corner-shape: squircle` the scale grows about 1.5x and corners become
  continuous, automatically, for these tokens. Use tokens, never `rounded-[Npx]`, for anything a
  finger touches.
- No square interactive element: `button`, `a`, `summary`, inputs and `[role=button]` get
  `--radius-control` in the base layer, so a plain text button ("Cancel", "Done", "Skip") has a
  rounded press area. Give it `h-11 px-2` so the hit area is 44px.
- Focus rings are keyboard only (`:focus-visible`; `:focus:not(:focus-visible)` has no outline).
  The outline follows the element's radius, so never put a ring on an element without one.
- Programmatic focus (a sheet opening, a heading on a new step) uses `tabIndex={-1}` on the target
  and never shows a ring; `Sheet` focuses the dialog itself, not its first button.

## 4. Spacing, rows, numbers

- Spacing scale 4, 8, 12, 16, 20, 24, 32, 44. Screen margin 16, between groups 24 to 32, inside a
  group 12. Section heading `text-title3 font-bold` then `mb-2`.
- Rows: min 44px (single line 48, with subtitle 56 to 64), padding 16 horizontal, separators 0.5px
  inset 16 from the left (52 with an icon). Chevron `›` in `text-label-2` for rows that navigate.
- One filled (pink) button per screen at most; others tinted or plain.
- `tnum` on every number that changes or is compared. "1h 20", "47 min", 24-hour time.
- Truncate long titles with `min-w-0 truncate`; numbers never truncate (`shrink-0`).

## 5. Before the PR

1. Screenshots at 390x844 light and dark, for the demo week AND a brand new user (empty account).
   Look at every screen you touched for zeros, repeats and filler.
2. Every progress indicator is a `ProgressBar` (or the tape). No `Array.from` of segments.
3. Every pressable thing has a radius token; tap it on a touch emulator: no ring. Tab to it: ring
   follows its shape.
4. Empty, loading, sparse and error states each answer one question with one action.
5. `pnpm check`, `pnpm test`, and `pnpm e2e` when you changed copy the e2e tests read.
