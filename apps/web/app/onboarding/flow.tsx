"use client";

import { GoalCategory, type Profile, type WeakSpot, type Weekday } from "@michael/shared";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { MiMark } from "@/components/brand";
import { CalendarGoals } from "@/components/goals/calendar-goals";
import { InstallSteps } from "@/components/nudge-primer";
import { ConnectionIcon } from "@/components/you/connection-icon";
import { CONNECTION_BUTTON } from "@/components/you/connection-row";
import { CONNECTION_ROUTES } from "@/lib/connections";
import type { FirstInsight } from "@/lib/first-insight";
import { hm } from "@/lib/format";
import { type Instruction, instructionText } from "@/lib/instructions";
import { markAsked, type NudgeState, useNudges } from "@/lib/use-nudges";
import { finishOnboarding, skipOnboarding } from "./actions";
import { FirstInsightCard } from "./first-insight";

// ---------- the questions' options ----------

// Starter goals in the three areas (Business, Health, Personal; Manolis, #131). Keyed by their own
// id: Training and Sleep are both Health. Sleep stays outside the score.
export type StarterId = "company" | "training" | "sleep" | "personal";

type GoalOption = {
  id: StarterId;
  area: "Business" | "Health" | "Personal";
  name: string;
  what: string;
  // Sleep is asked per night, the others per week. All stored as minutes per week.
  unit: "week" | "night";
  min: number;
  max: number;
  step: number;
  initial: number;
};

const GOALS: GoalOption[] = [
  {
    id: "company",
    area: "Business",
    name: "The company",
    what: "The work that moves it: building, selling, calls",
    unit: "week",
    min: 60,
    max: 50 * 60,
    step: 60,
    initial: 20 * 60,
  },
  {
    id: "training",
    area: "Health",
    name: "Training",
    what: "Gym, runs, swims, anything that counts",
    unit: "week",
    min: 30,
    max: 20 * 60,
    step: 30,
    initial: 4 * 60,
  },
  {
    id: "sleep",
    area: "Health",
    name: "Sleep",
    what: "Enough of it, at a sensible hour",
    unit: "night",
    min: 6 * 60,
    max: 10 * 60,
    step: 30,
    initial: 7.5 * 60,
  },
  {
    id: "personal",
    area: "Personal",
    name: "Time for yourself",
    what: "Family, friends, a night out",
    unit: "week",
    min: 30,
    max: 20 * 60,
    step: 30,
    initial: 3 * 60,
  },
];

// Personal goals need the new categories (#131). Until they land, the option is shown, not saved.
const PERSONAL_READY = (GoalCategory.options as readonly string[]).includes("personal");

/** Which starter an existing goal came from, for Redo setup. */
export function starterOf(category: GoalCategory | string): StarterId | null {
  if (category === "work" || category === "business") return "company";
  if (category === "gym" || category === "health") return "training";
  if (category === "rest") return "sleep";
  if (category === "personal") return "personal";
  return null;
}

// One tap standing instructions (rules Michael plans around), plus the user's own words.
const RULE_SEEDS: Pick<Instruction, "kind" | "days" | "time">[] = [
  { kind: "clear_day", days: [0] },
  { kind: "clear_day", days: [6] },
  { kind: "home_by", days: [1, 2, 3, 4, 5], time: "19:00" },
  { kind: "home_by", days: [1, 2, 3, 4, 5], time: "21:00" },
];
const RULES = RULE_SEEDS.map((r) => ({ ...r, text: instructionText({ ...r, text: "" }) }));

const DAYS: { id: Weekday; short: string; name: string }[] = [
  { id: "mon", short: "M", name: "Monday" },
  { id: "tue", short: "T", name: "Tuesday" },
  { id: "wed", short: "W", name: "Wednesday" },
  { id: "thu", short: "T", name: "Thursday" },
  { id: "fri", short: "F", name: "Friday" },
  { id: "sat", short: "S", name: "Saturday" },
  { id: "sun", short: "S", name: "Sunday" },
];

const WEAK_SPOTS: { id: WeakSpot; label: string }[] = [
  { id: "phone_in_bed", label: "Phone in bed" },
  { id: "late_nights", label: "Late nights" },
  { id: "context_switching", label: "Context switching" },
  { id: "skipped_lunch", label: "Skipped lunch" },
  { id: "doomscrolling", label: "Endless scrolling" },
  { id: "back_to_back_meetings", label: "Back to back meetings" },
  { id: "inbox_all_day", label: "Inbox open all day" },
  { id: "late_caffeine", label: "Coffee after 16:00" },
];

// Google Calendar goes straight to Google's consent screen and comes back to this same step, which
// then shows the first number about the week (#205). The watch and the Mac open their own setup
// pages (lib/connections.ts), whose back link returns here.
export const RESUME_PATH = "/onboarding?step=connect";
const CALENDAR_CONNECT = `/integrations/google/connect?return_to=${encodeURIComponent(RESUME_PATH)}`;
const SOURCES = [
  {
    id: "google-calendar",
    name: "Google Calendar",
    what: "What the day was meant to be",
    href: CALENDAR_CONNECT,
  },
  {
    id: "apple-watch",
    name: "Apple Watch",
    what: "Sleep and workouts",
    href: `${CONNECTION_ROUTES["apple-watch"]}?from=onboarding`,
  },
  {
    id: "mac",
    name: "Mac",
    what: "Apps and how long",
    href: `${CONNECTION_ROUTES.mac}?from=onboarding`,
  },
] as const;

// Every half hour, written the 24 hour way whatever the phone's locale.
const TIMES = Array.from(
  { length: 48 },
  (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);

const STEPS = 7;
const SAVE_STEP = 4; // answers are saved when leaving the house rules, before any link can leave the page
const CONNECT_STEP = SAVE_STEP + 1;

// ---------- small parts ----------

function Speaker() {
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-[30px] place-items-center rounded-full bg-label text-bg">
        <MiMark className="block h-auto w-[17px]" />
      </span>
      <span className="text-footnote font-semibold">Michael</span>
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div
      className="flex flex-1 justify-center gap-1.5"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={STEPS}
      aria-valuenow={step + 1}
      aria-label={`Question ${step + 1} of ${STEPS}`}
    >
      {Array.from({ length: STEPS }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed list of segments
          key={i}
          className={`h-[3px] w-5 rounded-full transition-colors duration-200 ${i <= step ? "bg-label" : "bg-context"}`}
        />
      ))}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
  label,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={`press min-h-11 rounded-full px-4 text-subhead font-semibold transition-colors duration-200 ${
        on ? "bg-label text-bg" : "bg-fill text-label"
      }`}
    >
      {children}
    </button>
  );
}

function DayPicker({
  value,
  onChange,
  label,
}: {
  value: Weekday[];
  onChange: (v: Weekday[]) => void;
  label: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-footnote font-semibold text-label-2">{label}</legend>
      <div className="flex justify-between gap-1">
        {DAYS.map((d) => {
          const on = value.includes(d.id);
          return (
            <button
              key={d.id}
              type="button"
              aria-pressed={on}
              aria-label={d.name}
              onClick={() =>
                onChange(
                  on
                    ? value.filter((x) => x !== d.id)
                    : DAYS.map((x) => x.id).filter((x) => x === d.id || value.includes(x)),
                )
              }
              className={`press grid size-11 place-items-center rounded-full text-subhead font-semibold transition-colors duration-200 ${
                on ? "bg-label text-bg" : "bg-fill text-label"
              }`}
            >
              {d.short}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function TimeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1.5">
      <span className="text-footnote font-semibold text-label-2">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="press h-14 w-full appearance-none rounded-group bg-fill px-4 text-center font-num text-title3 font-bold text-label tnum"
      >
        {TIMES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}

function Stepper({
  option,
  value,
  onChange,
}: {
  option: GoalOption;
  value: number;
  onChange: (v: number) => void;
}) {
  const text = `${hm(value)} a ${option.unit}`;
  const btn =
    "press grid size-11 place-items-center rounded-full bg-bg text-title3 font-semibold disabled:opacity-30";
  return (
    <div className="flex items-center justify-between gap-3 px-4 pb-3">
      <button
        type="button"
        className={btn}
        aria-label={`Less ${option.name.toLowerCase()}`}
        disabled={value <= option.min}
        onClick={() => onChange(Math.max(option.min, value - option.step))}
      >
        <span aria-hidden="true">−</span>
      </button>
      <output aria-live="polite" className="font-num text-title3 font-bold tnum">
        {text}
      </output>
      <button
        type="button"
        className={btn}
        aria-label={`More ${option.name.toLowerCase()}`}
        disabled={value >= option.max}
        onClick={() => onChange(Math.min(option.max, value + option.step))}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
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

const Separator = () => <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" />;

/** The closing screen's nudge primer: why, how often, and on iPhone the Home Screen steps first. */
function NudgeAsk({ state, error }: { state: NudgeState["kind"]; error: string | null }) {
  if (state === "on") {
    return (
      <p className="flex items-center gap-2 text-body">
        <Check on />
        Nudges are on. I buzz when a block starts.
      </p>
    );
  }
  if (state === "denied") {
    return (
      <p className="text-subhead text-label-2">
        Notifications are off for Michael. Turn them on in Settings, Notifications, Michael.
      </p>
    );
  }
  if (state !== "off" && state !== "working" && state !== "install") return null;
  return (
    <section aria-label="Nudges" className="rounded-group bg-fill px-4 pt-3 pb-4">
      <p className="text-body font-semibold">Want a buzz when a block starts?</p>
      <p className="mt-1 text-subhead text-label-2">
        {state === "install"
          ? "On iPhone, nudges only work with Michael on your Home Screen. Two taps."
          : "At most five a day, never in quiet hours. Your Apple Watch buzzes too."}
      </p>
      {state === "install" ? (
        <div className="mt-3">
          <InstallSteps />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-subhead text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

// ---------- the flow ----------

/** What is already saved: the answers start from it, so "Redo setup" shows the user's own week. */
export type Saved = {
  goals: { category: GoalCategory; weekly_minutes: number }[];
  profile: Profile | null;
  /** Standing instructions already set, by their text. */
  rules?: string[];
};

/** Back from Google: open on the connect step (or the closing screen), and say how it went. */
export type Resume = { calendar: "connected" | "failed" | null; step?: "connect" | "done" };

/** The calendar as the server sees it: connected or not, and the week's first number once it is. */
export type CalendarState = { connected: boolean; insight: FirstInsight | null };

export function OnboardingFlow({
  saved,
  resume,
  calendar,
}: {
  saved?: Saved;
  resume?: Resume;
  calendar?: CalendarState;
}) {
  const router = useRouter();
  const p = saved?.profile ?? null;
  const [step, setStep] = useState(resume?.step === "connect" ? CONNECT_STEP : resume ? STEPS - 1 : 0);
  const [picked, setPicked] = useState<StarterId[]>(() =>
    GOALS.map((g) => g.id).filter((id) => saved?.goals.some((x) => starterOf(x.category) === id)),
  );
  // Goals kept from the calendar (#134) count as an answer to the first question.
  const [keptFromCalendar, setKeptFromCalendar] = useState(0);
  const [minutes, setMinutes] = useState<Record<StarterId, number>>(() => {
    const m = Object.fromEntries(GOALS.map((g) => [g.id, g.initial])) as Record<StarterId, number>;
    for (const g of saved?.goals ?? []) {
      const id = starterOf(g.category);
      const opt = GOALS.find((x) => x.id === id);
      if (!id || !opt) continue;
      const v = id === "sleep" ? g.weekly_minutes / 7 : g.weekly_minutes;
      m[id] = Math.min(opt.max, Math.max(opt.min, Math.round(v / opt.step) * opt.step));
    }
    return m;
  });
  const [ownGoal, setOwnGoal] = useState("");
  const [rules, setRules] = useState<string[]>(saved?.rules ?? []);
  const [ownRule, setOwnRule] = useState("");
  const [workStart, setWorkStart] = useState(p?.work_hours.start ?? "09:00");
  const [workEnd, setWorkEnd] = useState(p?.work_hours.end ?? "18:00");
  const [workDays, setWorkDays] = useState<Weekday[]>(p?.work_days ?? ["mon", "tue", "wed", "thu", "fri"]);
  const [gymDays, setGymDays] = useState<Weekday[]>(p?.gym_days.length ? p.gym_days : ["tue", "thu", "sat"]);
  const [weakSpots, setWeakSpots] = useState<WeakSpot[]>(p?.weak_spots ?? []);
  const [quietStart, setQuietStart] = useState(p?.quiet_hours.start ?? "22:00");
  const [quietEnd, setQuietEnd] = useState(p?.quiet_hours.end ?? "07:00");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Nudges are offered at the end, once the plan exists; reading the state asks for nothing (#207).
  const nudges = useNudges(step === STEPS - 1);

  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const direction = useRef(1);
  const shown = useRef(step);

  // A calm entrance for each question; opacity only when the user asks for less motion.
  // Compares with the last step shown, so the first render (and a re-run of the effect) stays put.
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    const el = panel.current;
    if (!el?.animate) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.animate(
      reduce
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: `translateX(${direction.current * 24}px)` },
            { opacity: 1, transform: "none" },
          ],
      { duration: reduce ? 120 : 320, easing: "cubic-bezier(.23, 1, .32, 1)" },
    );
  }, [step]);

  const go = (to: number) => {
    direction.current = to > step ? 1 : -1;
    setFailed(false);
    setStep(to);
  };

  const hasGym = picked.includes("training");

  async function save() {
    setBusy(true);
    setFailed(false);
    const res = await finishOnboarding({
      goals: [
        ...GOALS.filter((g) => picked.includes(g.id) && (g.id !== "personal" || PERSONAL_READY)).map((g) => ({
          key: g.id,
          weekly_minutes: g.unit === "night" ? minutes[g.id] * 7 : minutes[g.id],
        })),
        ...(ownGoal.trim() ? [{ key: "own" as const, title: ownGoal.trim(), weekly_minutes: 5 * 60 }] : []),
      ],
      rules: [
        ...RULES.filter((r) => rules.includes(r.text)),
        ...(ownRule.trim() ? [{ kind: "custom" as const, text: ownRule.trim() }] : []),
      ],
      profile: {
        work_hours: { start: workStart, end: workEnd },
        work_days: workDays,
        gym_days: hasGym ? gymDays : [],
        weak_spots: weakSpots,
        quiet_hours: { start: quietStart, end: quietEnd },
      },
    }).catch(() => ({ ok: false }));
    setBusy(false);
    if (res.ok) go(SAVE_STEP + 1);
    else setFailed(true);
  }

  async function skip() {
    setBusy(true);
    await skipOnboarding().catch(() => null);
    router.replace("/");
  }

  function finish() {
    router.replace("/");
    router.refresh();
  }

  function next() {
    if (step === SAVE_STEP) void save();
    else if (step === STEPS - 1) finish();
    else go(step + 1);
  }

  // ---------- each screen: the question, the line under it, the controls ----------

  const weekly = GOALS.filter((g) => picked.includes(g.id) && g.unit === "week")
    .map((g) => `${hm(minutes[g.id])} for ${g.id === "company" ? "the company" : g.name.toLowerCase()}`)
    .join(", ")
    .replace(/, ([^,]*)$/, " and $1");
  const sleep = picked.includes("sleep") ? hm(minutes.sleep) : null;

  const calendarOn = calendar?.connected === true || resume?.calendar === "connected";
  const calendarFailed = !calendarOn && resume?.calendar === "failed";
  const insight = calendarOn ? (calendar?.insight ?? null) : null;
  const askNudges = nudges.state.kind === "off" || nudges.state.kind === "working";

  type Screen = {
    q: string;
    line: ReactNode;
    body?: ReactNode;
    cta: string;
    ready?: boolean;
    /** The primary leaves the page (Google's consent screen): a plain link instead of a button. */
    href?: string;
    /** The primary does something other than moving on. */
    onCta?: () => void;
    /** A quiet text button under the primary, for "not now". */
    later?: { label: string; onClick: () => void };
  };

  const screens: Screen[] = [
    {
      // Voice sheet, onboarding 1, as written.
      q: "What are you working towards?",
      line: "I'm Michael. I learn how your days really go, then I give you time back for what you want. Your own words.",
      cta: picked.length === 0 && !ownGoal.trim() && keptFromCalendar === 0 ? "Pick at least one" : "Next",
      ready: picked.length > 0 || ownGoal.trim().length > 0 || keptFromCalendar > 0,
      body: (
        <div className="flex flex-col gap-2">
          <ul className="overflow-hidden rounded-group bg-fill">
            {GOALS.map((g, i) => {
              const on = picked.includes(g.id);
              const locked = g.id === "personal" && !PERSONAL_READY;
              return (
                <li key={g.id} className="relative">
                  {i > 0 ? <Separator /> : null}
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={locked}
                    onClick={() => setPicked((p) => (on ? p.filter((c) => c !== g.id) : [...p, g.id]))}
                    className={`press flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left ${locked ? "opacity-50" : ""}`}
                  >
                    <Check on={on} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body font-semibold">{g.name}</span>
                      <span className="text-footnote text-label-2">
                        {locked ? "Switches on later tonight" : g.what}
                      </span>
                    </span>
                    <span className="shrink-0 text-footnote text-label-2">{g.area}</span>
                  </button>
                  {on ? (
                    <Stepper
                      option={g}
                      value={minutes[g.id]}
                      onChange={(v) => setMinutes((m) => ({ ...m, [g.id]: v }))}
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
                value={ownGoal}
                onChange={(e) => setOwnGoal(e.target.value)}
                maxLength={60}
                autoComplete="off"
                placeholder="Something else, in your own words"
                className="min-h-14 w-full bg-transparent px-4 text-body text-label outline-none placeholder:text-label-2"
              />
            </li>
          </ul>
          {ownGoal.trim() ? (
            <p className="px-4 text-footnote text-label-2">
              5h a week to start, under Business. Change it on Goals.
            </p>
          ) : null}
        </div>
      ),
    },
    {
      q: "What does a usual week look like?",
      line: "Roughly is fine. I learn the rest from your days.",
      cta: "Next",
      body: (
        <div className="flex flex-col gap-6">
          <div className="flex items-end gap-3">
            <TimeSelect label="Work starts" value={workStart} onChange={setWorkStart} />
            <TimeSelect label="Work ends" value={workEnd} onChange={setWorkEnd} />
          </div>
          <DayPicker label="Work days" value={workDays} onChange={setWorkDays} />
          {hasGym ? <DayPicker label="Training days" value={gymDays} onChange={setGymDays} /> : null}
        </div>
      ),
    },
    {
      q: "Where does your time leak?",
      line: "Pick the honest ones. I watch for these first.",
      cta: weakSpots.length === 0 ? "None of these" : "Next",
      body: (
        <div className="flex flex-wrap gap-2">
          {WEAK_SPOTS.map((w) => {
            const on = weakSpots.includes(w.id);
            return (
              <Chip
                key={w.id}
                on={on}
                onClick={() => setWeakSpots((s) => (on ? s.filter((x) => x !== w.id) : [...s, w.id]))}
              >
                {w.label}
              </Chip>
            );
          })}
        </div>
      ),
    },
    {
      q: "When should I stay quiet?",
      line: "No nudges in these hours. Not even a buzz.",
      cta: "Next",
      body: (
        <div className="flex items-end gap-3">
          <TimeSelect label="Quiet from" value={quietStart} onChange={setQuietStart} />
          <TimeSelect label="Until" value={quietEnd} onChange={setQuietEnd} />
        </div>
      ),
    },
    {
      // Copy pending Brand's check (#168 comment): the step for standing instructions.
      q: "What should I never plan over?",
      line: "House rules. I plan around them every day, and tell you when a block breaks one.",
      cta: busy ? "Saving" : rules.length === 0 && !ownRule.trim() ? "None for now" : "Next",
      body: (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {RULES.map((r) => {
              const on = rules.includes(r.text);
              return (
                <Chip
                  key={r.text}
                  on={on}
                  onClick={() => setRules((x) => (on ? x.filter((t) => t !== r.text) : [...x, r.text]))}
                >
                  {r.text}
                </Chip>
              );
            })}
          </div>
          <div className="overflow-hidden rounded-group bg-fill">
            <label htmlFor="own-rule" className="sr-only">
              A rule in your own words
            </label>
            <input
              id="own-rule"
              value={ownRule}
              onChange={(e) => setOwnRule(e.target.value)}
              maxLength={140}
              autoComplete="off"
              placeholder="Something else, in your own words"
              className="min-h-14 w-full bg-transparent px-4 text-body text-label outline-none placeholder:text-label-2"
            />
          </div>
        </div>
      ),
    },
    {
      q: "Let me see your day.",
      line: calendarOn
        ? "Your calendar is in. That's enough for a first number."
        : calendarFailed
          ? "Google Calendar did not connect. Try once more, or later from You."
          : "Start with your calendar. Nothing is read until you connect it.",
      // The recommended action is the filled button; skipping is a quiet "Later" (#205).
      cta: calendarOn ? "Next" : "Connect Google Calendar",
      href: calendarOn ? undefined : CALENDAR_CONNECT,
      later: calendarOn ? undefined : { label: "Later", onClick: () => go(step + 1) },
      body: (
        <div className="flex flex-col gap-6">
          {insight ? <FirstInsightCard insight={insight} /> : null}
          <ul className="overflow-hidden rounded-group bg-fill">
            {SOURCES.map((src, i) => {
              const connected = src.id === "google-calendar" && calendarOn;
              // The same row as on You (#260): icon, name, one line, one pill.
              return (
                <li key={src.id} className="relative">
                  {i > 0 ? <Separator /> : null}
                  <div className="flex min-h-16 items-center gap-3 px-4 py-2.5">
                    <span className={connected ? "text-label" : "text-label-2"}>
                      <ConnectionIcon id={src.id} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body">{src.name}</span>
                      <span className="text-footnote text-label-2">{src.what}</span>
                    </span>
                    {connected ? (
                      <span className="flex items-center gap-1.5 text-subhead text-label-2">
                        <Check on />
                        Connected
                      </span>
                    ) : (
                      // Plain <a>: a route handler that redirects must never be prefetched.
                      <a href={src.href} className={CONNECTION_BUTTON} aria-label={`Connect ${src.name}`}>
                        Connect
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ),
    },
    {
      q: "Right. Let's get to work.",
      line: (
        <>
          {resume?.calendar === "connected" ? <>Google Calendar is connected. </> : null}
          {resume?.calendar === "failed" ? <>Google Calendar did not connect. Try again from You.</> : null}
          {weekly ? <>Each week, {weekly}. </> : null}
          {sleep ? <>Sleep {sleep} a night. </> : null}I find the time you lose and give it back. First brief
          tomorrow at <span className="tnum">{quietEnd}</span>.
        </>
      ),
      // The end of the first talk is when a buzz helps: the plan exists. A primer first, then the
      // system prompt from the tap; Not now keeps the prompt for later (#207).
      cta: askNudges ? (nudges.state.kind === "working" ? "Asking your phone" : "Turn on nudges") : "Start",
      ready: nudges.state.kind !== "working",
      onCta: askNudges ? () => void nudges.turnOn() : undefined,
      later: askNudges
        ? {
            label: "Not now",
            onClick: () => {
              markAsked();
              finish();
            },
          }
        : undefined,
      body: <NudgeAsk state={nudges.state.kind} error={nudges.error} />,
    },
  ];

  const s = screens[step] ?? (screens[0] as Screen);
  const ready = s.ready ?? true;
  const primary =
    "press h-[50px] w-full rounded-full bg-tint text-body font-semibold text-on-tint transition-opacity duration-200 disabled:opacity-40";

  return (
    <main className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] pr-[max(16px,env(safe-area-inset-right))] pb-[calc(16px+env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))]">
      <nav aria-label="Onboarding" className="flex min-h-11 items-center gap-2 pt-2">
        <div className="w-16">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => go(step - 1)}
              className="press -ml-2 flex h-11 items-center px-2 text-body font-semibold text-tint-text"
            >
              Back
            </button>
          ) : null}
        </div>
        <Progress step={step} />
        <div className="flex w-16 justify-end">
          {step <= SAVE_STEP ? (
            <button
              type="button"
              onClick={skip}
              disabled={busy}
              className="press -mr-2 flex h-11 items-center px-2 text-body text-label-2"
            >
              Skip
            </button>
          ) : null}
        </div>
      </nav>

      <div ref={panel} className="flex flex-1 flex-col">
        <div className="mt-8">
          <Speaker />
          <h1
            ref={heading}
            tabIndex={-1}
            // Focus lands here for screen readers on every step; a ring on a heading means nothing.
            style={{ outline: "none" }}
            className="mt-3 text-large-title font-bold tracking-[0.01em]"
          >
            {s.q}
          </h1>
          <p className="mt-2 text-body text-label-2">{s.line}</p>
        </div>
        {step === 0 ? <CalendarGoals className="mt-8" onKept={setKeptFromCalendar} /> : null}
        {s.body ? <div className="mt-8">{s.body}</div> : null}
      </div>

      <div className="sticky bottom-[calc(16px+env(safe-area-inset-bottom))] mt-8 bg-bg pt-3">
        {failed ? (
          <p role="alert" className="mb-3 text-center text-footnote text-danger">
            I could not save that. Try again.
          </p>
        ) : null}
        {s.href ? (
          <a href={s.href} className={`${primary} flex items-center justify-center`}>
            {s.cta}
          </a>
        ) : (
          <button type="button" onClick={s.onCta ?? next} disabled={!ready || busy} className={primary}>
            {s.cta}
          </button>
        )}
        {s.later ? (
          <button
            type="button"
            onClick={s.later.onClick}
            disabled={busy}
            className="press mx-auto mt-1 flex h-11 items-center px-4 text-body text-label-2"
          >
            {s.later.label}
          </button>
        ) : null}
      </div>
    </main>
  );
}
