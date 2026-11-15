"use client";

import type { GoalArea, GoalCategory, GoalSuggestion } from "@michael/shared";
import { goalArea } from "@michael/shared/goal-areas";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConnectionIcon } from "@/components/you/connection-icon";
import { hm } from "@/lib/format";
import { finishOnboarding, skipOnboarding } from "./actions";
import { OnboardingFrame, primaryButton, Separator } from "./frame";

// Onboarding, screen 1 of 2: the goals, in one screen. With the calendar in, Michael lists what he
// found in the user's own week (#134), ticked and with the hours filled in; the usual starters sit
// under them, unticked. Without the calendar, the starters lead and the calendar is one tap above
// them. One tap keeps the lot; hours change with minus and plus, everything else later on Goals.
// Each row says its area (Business, Health, Personal), and the last row takes a goal in the user's
// own words (carried over from Manolis' #190).

type Starter = {
  category: GoalCategory;
  name: string;
  what: string;
  // Sleep is asked per night, the others per week. All stored as minutes per week.
  unit: "week" | "night";
  min: number;
  max: number;
  step: number;
  initial: number;
};

const STARTERS: Starter[] = [
  {
    category: "work",
    name: "Deep work",
    what: "Focus blocks, no meetings, no phone",
    unit: "week",
    min: 60,
    max: 50 * 60,
    step: 60,
    initial: 10 * 60,
  },
  {
    category: "gym",
    name: "Training",
    what: "Gym, runs, swims, anything that counts",
    unit: "week",
    min: 30,
    max: 20 * 60,
    step: 30,
    initial: 4 * 60,
  },
  {
    category: "rest",
    name: "Sleep",
    what: "Enough of it, at a sensible hour",
    unit: "night",
    min: 6 * 60,
    max: 10 * 60,
    step: 30,
    initial: 7.5 * 60,
  },
  {
    category: "food",
    name: "Proper meals",
    what: "Sit down meals, away from the screen",
    unit: "week",
    min: 60,
    max: 21 * 60,
    step: 30,
    initial: 5 * 60,
  },
  {
    category: "personal",
    name: "Time for yourself",
    what: "Family, friends, a night out",
    unit: "week",
    min: 30,
    max: 20 * 60,
    step: 30,
    initial: 3 * 60,
  },
];

const AREA_LABEL: Record<GoalArea, string> = { business: "Business", health: "Health", personal: "Personal" };

/** A goal in the user's own words starts here; Goals changes it later. */
const OWN_GOAL_MINUTES = 5 * 60;

/** At most three suggestions start ticked: two or three goals is a week anyone can hold. */
const TICKED = 3;

type Row = {
  key: string;
  title: string;
  sub: string;
  unit: "week" | "night";
  min: number;
  max: number;
  step: number;
  initial: number;
  suggestion?: string;
  category?: GoalCategory;
  area: GoalArea;
};

/** A goal the user already has (Redo setup): its starter row starts ticked with its own hours. */
export type SavedGoal = { title: string; category: GoalCategory; weekly_minutes: number | null };

function rowsFor(suggestions: GoalSuggestion[], saved: SavedGoal[]): Row[] {
  const found = suggestions.map(
    (s): Row => ({
      key: `s:${s.id}`,
      title: s.title,
      sub: s.evidence,
      unit: "week",
      min: 30,
      max: 40 * 60,
      step: 30,
      initial: s.weekly_budget_minutes,
      suggestion: s.id,
      area: s.area,
    }),
  );
  const taken = new Set(found.map((r) => r.title.toLowerCase()));
  // A goal already kept under another category (a calendar "Training") stands for its starter.
  for (const g of saved)
    if (!STARTERS.some((x) => x.category === g.category)) taken.add(g.title.toLowerCase());
  const starters = STARTERS.filter((g) => !taken.has(g.name.toLowerCase())).map((g): Row => {
    const mine = saved.find((x) => x.category === g.category)?.weekly_minutes;
    const own = mine == null ? null : g.unit === "night" ? mine / 7 : mine;
    return {
      key: `c:${g.category}`,
      title: g.name,
      sub: g.what,
      unit: g.unit,
      min: g.min,
      max: g.max,
      step: g.step,
      initial: own == null ? g.initial : Math.min(g.max, Math.max(g.min, Math.round(own / g.step) * g.step)),
      category: g.category,
      area: goalArea(g.category),
    };
  });
  return [...found, ...starters];
}

function Check({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-200 ${
        on ? "bg-label text-bg" : "shadow-[inset_0_0_0_1.5px_var(--m-label-2)]"
      }`}
    >
      {on ? (
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}

function Stepper({ row, value, onChange }: { row: Row; value: number; onChange: (v: number) => void }) {
  const btn =
    "press grid size-9 place-items-center rounded-full bg-bg text-body font-semibold disabled:opacity-30";
  const name = row.title.toLowerCase();
  return (
    <div className="flex items-center gap-3 pr-4 pb-3 pl-[52px]">
      <button
        type="button"
        className={btn}
        aria-label={`Less ${name}`}
        disabled={value <= row.min}
        onClick={() => onChange(Math.max(row.min, value - row.step))}
      >
        <span aria-hidden="true">−</span>
      </button>
      <output aria-live="polite" className="min-w-[7.5rem] text-center font-num text-body font-bold tnum">
        {hm(value)} a {row.unit}
      </output>
      <button
        type="button"
        className={btn}
        aria-label={`More ${name}`}
        disabled={value >= row.max}
        onClick={() => onChange(Math.min(row.max, value + row.step))}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

const count = (n: number) =>
  n === 1 ? "this goal" : n === 2 ? "these two" : n === 3 ? "these three" : `these ${n}`;

export function GoalsStep({
  suggestions,
  saved = [],
  calendar,
  calendarHref,
}: {
  suggestions: GoalSuggestion[];
  saved?: SavedGoal[];
  /** "on" connected, "off" not yet, "failed" the user came back from Google without it. */
  calendar: "on" | "off" | "failed";
  calendarHref: string;
}) {
  const router = useRouter();
  const [rows] = useState(() => rowsFor(suggestions, saved));
  const [picked, setPicked] = useState<string[]>(() => {
    const mine = rows
      .filter((r) => r.category && saved.some((g) => g.category === r.category))
      .map((r) => r.key);
    const found = rows
      .filter((r) => r.suggestion)
      .slice(0, TICKED)
      .map((r) => r.key);
    if (found.length > 0 || saved.length > 0) return [...found, ...mine];
    return ["c:work", "c:gym"];
  });
  const [minutes, setMinutes] = useState<Record<string, number>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, r.initial])),
  );
  const [own, setOwn] = useState("");
  const ownTitle = own.trim();
  const [busy, setBusy] = useState<"save" | "skip" | null>(null);
  const [failed, setFailed] = useState(false);

  // Back from the next step with the browser's Back: the page comes from the cache, reset the button.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(null);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  async function save() {
    setBusy("save");
    setFailed(false);
    const chosen = rows.filter((r) => picked.includes(r.key));
    const res = await finishOnboarding({
      kept: chosen
        .filter((r) => r.suggestion)
        .map((r) => ({ id: r.suggestion as string, weekly_minutes: minutes[r.key] ?? r.initial })),
      goals: chosen
        .filter((r) => r.category)
        .map((r) => {
          const m = minutes[r.key] ?? r.initial;
          return { category: r.category as GoalCategory, weekly_minutes: r.unit === "night" ? m * 7 : m };
        }),
      own: ownTitle ? { title: ownTitle, weekly_minutes: OWN_GOAL_MINUTES } : undefined,
    }).catch(() => ({ ok: false }));
    if (res.ok) {
      // Stays "Saving" until the next screen paints: it reads the week with the new goals.
      router.push("/onboarding?step=connect");
      return;
    }
    setFailed(true);
    setBusy(null);
  }

  async function skip() {
    setBusy("skip");
    await skipOnboarding().catch(() => null);
    router.replace("/");
  }

  const found = suggestions.length > 0;
  const n = picked.length + (ownTitle ? 1 : 0);
  // Redo setup with nothing new found: the goals are already in, moving on is enough.
  const already = saved.length > 0;

  return (
    <OnboardingFrame
      step={0}
      title={found ? "Here's what your week is for." : "What are we playing for?"}
      line={
        found
          ? "I read it off your calendar. Keep what's right; we'll tune the hours together."
          : // The voice sheet's opening (Manolis, #190), then what to do.
            "I'm Michael. I learn how your days really go, then win time back for what matters to you. Pick two or three."
      }
      right={
        <button
          type="button"
          onClick={skip}
          disabled={busy !== null}
          className="press -mr-2 flex h-11 items-center px-2 text-body text-label-2"
        >
          Skip
        </button>
      }
      footer={
        <>
          {failed ? (
            <p role="alert" className="mb-3 text-center text-footnote text-danger">
              I couldn't save that. Nothing changed. Try again.
            </p>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={(n === 0 && !already) || busy !== null}
            aria-busy={busy === "save"}
            className={primaryButton}
          >
            {busy === "save"
              ? "Saving"
              : n === 0
                ? already
                  ? "Next"
                  : "Pick at least one"
                : `Keep ${count(n)}`}
          </button>
        </>
      }
    >
      {calendar !== "on" ? (
        <div className="mb-6">
          <div className="flex min-h-16 items-center gap-3 rounded-group bg-fill py-2.5 pr-4 pl-4">
            <ConnectionIcon id="google-calendar" className="size-6 text-label-2" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body">Google Calendar</span>
              <span className={`text-footnote ${calendar === "failed" ? "text-danger" : "text-label-2"}`}>
                {calendar === "failed"
                  ? "That didn't connect. One more go."
                  : "I find your goals in your week."}
              </span>
            </span>
            {/* Plain <a>: the route redirects to Google and must never be prefetched. */}
            <a
              href={calendarHref}
              className="hit press flex h-9 w-[6.5rem] shrink-0 items-center justify-center rounded-full bg-tint/14 text-subhead font-semibold text-tint-text"
            >
              Connect
            </a>
          </div>
        </div>
      ) : null}

      <ul className="overflow-hidden rounded-group bg-fill">
        {rows.map((r, i) => {
          const on = picked.includes(r.key);
          const firstStarter = found && !r.suggestion && rows[i - 1]?.suggestion;
          return (
            <li key={r.key} className="relative">
              {i > 0 ? <Separator inset={firstStarter ? 0 : 52} /> : null}
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(r.key)}
                className="press flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
              >
                <Check on={on} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body font-semibold">{r.title}</span>
                  <span className="text-footnote text-label-2">{r.sub}</span>
                </span>
                <span className="shrink-0 text-footnote text-label-2">{AREA_LABEL[r.area]}</span>
              </button>
              {on ? (
                <Stepper
                  row={r}
                  value={minutes[r.key] ?? r.initial}
                  onChange={(v) => setMinutes((m) => ({ ...m, [r.key]: v }))}
                />
              ) : null}
            </li>
          );
        })}
        <li className="relative">
          <Separator />
          <label htmlFor="own-goal" className="sr-only">
            Something else, in your own words
          </label>
          <input
            id="own-goal"
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            maxLength={60}
            autoComplete="off"
            enterKeyHint="done"
            placeholder="Something else, in your own words"
            className="min-h-14 w-full bg-transparent px-4 text-body text-label outline-none placeholder:text-label-2"
          />
        </li>
      </ul>
      {ownTitle ? (
        <p className="mt-2 px-4 text-footnote text-label-2">
          <span className="tnum">{hm(OWN_GOAL_MINUTES)}</span> a week to start, under Business. Change it on
          Goals.
        </p>
      ) : null}
    </OnboardingFrame>
  );
}
