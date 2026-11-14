"use client";

import type { GoalCategory, WeakSpot, Weekday } from "@michael/shared";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { MiMark } from "@/components/brand";
import { hm } from "@/lib/format";
import { finishOnboarding, skipOnboarding } from "./actions";

// ---------- the questions' options ----------

type GoalOption = {
  category: GoalCategory;
  name: string;
  what: string;
  // Rest is asked per night, the others per week. All stored as minutes per week.
  unit: "week" | "night";
  min: number;
  max: number;
  step: number;
  initial: number;
};

const GOALS: GoalOption[] = [
  {
    category: "work",
    name: "Deep work",
    what: "Focus blocks with no meetings and no phone",
    unit: "week",
    min: 60,
    max: 50 * 60,
    step: 60,
    initial: 20 * 60,
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
];

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

// Google Calendar goes straight to Google's consent screen (and back to You). The watch and the Mac
// are set up from the You screen until they have their own one tap connect.
const SOURCES = [
  {
    name: "Google Calendar",
    what: "Your plans, so I know what the day was meant to be",
    href: "/integrations/google/connect",
  },
  { name: "Apple Watch", what: "Sleep, workouts and heart rate", href: "/you" },
  { name: "Mac", what: "Which apps you use, and for how long", href: "/you" },
] as const;

// Every half hour, written the 24 hour way whatever the phone's locale.
const TIMES = Array.from(
  { length: 48 },
  (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);

const STEPS = 6;
const SAVE_STEP = 3; // answers are saved when leaving quiet hours, before any link can leave the page

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

// ---------- the flow ----------

export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<GoalCategory[]>([]);
  const [minutes, setMinutes] = useState<Record<GoalCategory, number>>(
    () => Object.fromEntries(GOALS.map((g) => [g.category, g.initial])) as Record<GoalCategory, number>,
  );
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("18:00");
  const [workDays, setWorkDays] = useState<Weekday[]>(["mon", "tue", "wed", "thu", "fri"]);
  const [gymDays, setGymDays] = useState<Weekday[]>(["tue", "thu", "sat"]);
  const [weakSpots, setWeakSpots] = useState<WeakSpot[]>([]);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("07:00");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const direction = useRef(1);
  const mounted = useRef(false);

  // A calm entrance for each question; opacity only when the user asks for less motion.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every step change
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
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

  const hasGym = picked.includes("gym");

  async function save() {
    setBusy(true);
    setFailed(false);
    const res = await finishOnboarding({
      goals: GOALS.filter((g) => picked.includes(g.category)).map((g) => ({
        category: g.category,
        weekly_minutes: g.unit === "night" ? minutes[g.category] * 7 : minutes[g.category],
      })),
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

  function next() {
    if (step === SAVE_STEP) void save();
    else if (step === STEPS - 1) {
      router.replace("/");
      router.refresh();
    } else go(step + 1);
  }

  // ---------- each screen: the question, the line under it, the controls ----------

  const weekly = GOALS.filter((g) => picked.includes(g.category) && g.unit === "week")
    .map((g) => `${hm(minutes[g.category])} of ${g.name.toLowerCase()}`)
    .join(", ")
    .replace(/, ([^,]*)$/, " and $1");
  const sleep = picked.includes("rest") ? hm(minutes.rest) : null;

  const screens: { q: string; line: ReactNode; body?: ReactNode; cta: string; ready?: boolean }[] = [
    {
      q: "What are we playing for?",
      line: "Tap the goals that matter. I guard their time every week.",
      cta: picked.length === 0 ? "Pick at least one" : "Next",
      ready: picked.length > 0,
      body: (
        <ul className="overflow-hidden rounded-group bg-fill">
          {GOALS.map((g, i) => {
            const on = picked.includes(g.category);
            return (
              <li key={g.category} className="relative">
                {i > 0 ? <Separator /> : null}
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setPicked((p) => (on ? p.filter((c) => c !== g.category) : [...p, g.category]))
                  }
                  className="press flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <Check on={on} />
                  <span className="flex flex-col">
                    <span className="text-body font-semibold">{g.name}</span>
                    <span className="text-footnote text-label-2">{g.what}</span>
                  </span>
                </button>
                {on ? (
                  <Stepper
                    option={g}
                    value={minutes[g.category]}
                    onChange={(v) => setMinutes((m) => ({ ...m, [g.category]: v }))}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
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
      cta: busy ? "Saving" : "Next",
      body: (
        <div className="flex items-end gap-3">
          <TimeSelect label="Quiet from" value={quietStart} onChange={setQuietStart} />
          <TimeSelect label="Until" value={quietEnd} onChange={setQuietEnd} />
        </div>
      ),
    },
    {
      q: "Let me see your day.",
      line: "One tap each. Every source stays off until you connect it, and you can switch it off any time.",
      cta: "Next",
      body: (
        <ul className="overflow-hidden rounded-group bg-fill">
          {SOURCES.map((s, i) => (
            <li key={s.name} className="relative">
              {i > 0 ? <Separator /> : null}
              {/* Plain <a>: a route handler that redirects must never be prefetched. */}
              <a href={s.href} className="press flex min-h-14 items-center gap-3 px-4 py-3">
                <span className="flex flex-1 flex-col">
                  <span className="text-body font-semibold">{s.name}</span>
                  <span className="text-footnote text-label-2">{s.what}</span>
                </span>
                <span className="text-body font-semibold text-tint-text">Connect</span>
              </a>
            </li>
          ))}
        </ul>
      ),
    },
    {
      q: "Right. Let's get to work.",
      line: (
        <>
          {weekly ? <>{weekly.charAt(0).toUpperCase() + weekly.slice(1)} a week. </> : null}
          {sleep ? <>Sleep {sleep} a night. </> : null}I find the time you lose and give it back. First brief
          tomorrow at <span className="tnum">{quietEnd}</span>.
        </>
      ),
      cta: "Start",
    },
  ];

  const s = screens[step] ?? (screens[0] as (typeof screens)[number]);
  const ready = s.ready ?? true;

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
            className="mt-3 text-large-title font-bold tracking-[0.01em] outline-none"
          >
            {s.q}
          </h1>
          <p className="mt-2 text-body text-label-2">{s.line}</p>
        </div>
        {s.body ? <div className="mt-8">{s.body}</div> : null}
      </div>

      <div className="sticky bottom-[calc(16px+env(safe-area-inset-bottom))] mt-8 bg-bg pt-3">
        {failed ? (
          <p role="alert" className="mb-3 text-center text-footnote text-danger">
            I could not save that. Try again.
          </p>
        ) : null}
        <button
          type="button"
          onClick={next}
          disabled={!ready || busy}
          className="press h-[50px] w-full rounded-full bg-tint text-body font-semibold text-on-tint transition-opacity duration-200 disabled:opacity-40"
        >
          {s.cta}
        </button>
      </div>
    </main>
  );
}
