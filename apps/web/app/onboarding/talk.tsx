"use client";

import type { GoalArea, GoalWordsResponse, HeardGoal } from "@michael/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Michael, type MichaelState } from "@/components/michael";
import { PushToTalk } from "@/components/voice/push-to-talk";
import { checkRecorderPath, currentInputMode, subscribeInputMode } from "@/components/voice/recorder";
import { primeSpeech, speakReply, stopSpeaking, unlockAudio } from "@/components/voice/speech";
import { hm } from "@/lib/format";
import { finishOnboarding, hearGoals, skipOnboarding } from "./actions";
import { OnboardingFrame, primaryButton, quietButton, Separator } from "./frame";
import { Check } from "./goals-step";

// Getting started is a talk with Michael, not a form (Loukas, Sun 15 Nov). He introduces himself in
// a few animated lines (with his voice, one tap away), then asks three questions out loud. The user
// holds the mic and answers, or types: a noisy room is one tap from the keyboard, and any question
// can be skipped. Every answer lands in a text box first, so a misheard word is fixed before it
// counts. Then the API reads the answers, however messy, into goals with weekly hours, and the
// review shows what he heard, each goal with the user's own words under it and "my estimate" on
// hours nobody said. Nothing is saved until the user keeps it. The calendar comes after, on connect.

const INTRO = [
  "I'm Michael.",
  "I find the time you lose every day and give it back to your goals.",
  "Tell me what you're working towards. Connect your calendar, and I learn how your days really go.",
  "Every day I learn more. I tell you what pulls you off course, and what to fix.",
];

type Question = { ask: string; hint: string };

const QUESTIONS: Question[] = [
  {
    ask: "What are you working towards right now?",
    hint: "Business, health, the people in your life. Whatever matters most.",
  },
  {
    ask: "What would make this a good week?",
    hint: "Say roughly how much time each thing needs.",
  },
  {
    ask: "Where does your time go that you wish it didn't?",
    hint: "The phone, meetings, late nights. It stays between us.",
  },
];

const AREA_LABEL: Record<GoalArea, string> = { business: "Business", health: "Health", personal: "Personal" };

/** Words per second the intro shows at: quick when silent, at his speaking pace with the voice. */
const SILENT_MS = 55;
const SPOKEN_MS = 330;

type Phase = "intro" | "ask" | "hearing" | "review";
type Input = "voice" | "text";
type Row = HeardGoal & { key: string; on: boolean };

const count = (n: number) =>
  n === 1 ? "this goal" : n === 2 ? "these two" : n === 3 ? "these three" : `these ${n}`;

// ---------- the intro: his words arrive one by one ----------

function AnimatedLines({ lines, pace, run }: { lines: string[]; pace: number; run: number }) {
  let i = 0;
  return (
    <div key={run} className="flex flex-col gap-3">
      {lines.map((line, n) => {
        const Tag = n === 0 ? "h1" : "p";
        return (
          <Tag
            key={line}
            className={n === 0 ? "text-large-title font-bold tracking-[0.01em]" : "text-title3 text-label-2"}
          >
            {line.split(" ").map((word, w) => {
              const delay = i++ * pace + n * pace * 2;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed copy, a word can repeat in a line
                <Fragment key={`${word}-${w}`}>
                  <span className="m-word-in inline-block" style={{ animationDelay: `${delay}ms` }}>
                    {word}
                  </span>{" "}
                </Fragment>
              );
            })}
          </Tag>
        );
      })}
    </div>
  );
}

// ---------- the sound switch ----------

function SoundButton({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      aria-label={on ? "Michael's voice is on" : "Michael's voice is off"}
      className="press -ml-2 grid size-11 place-items-center text-label-2"
    >
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
        {on ? (
          <path
            d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        ) : (
          <path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}

// ---------- one answer: the mic, or the keyboard, always the text box ----------

function Answer({
  value,
  onChange,
  input,
  onInput,
  voicePossible,
  onListening,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  input: Input;
  onInput: (i: Input) => void;
  voicePossible: boolean;
  onListening: (on: boolean) => void;
  label: string;
  placeholder: string;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  // What was there before this hold: a second hold adds to the answer instead of replacing it.
  const before = useRef("");
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const join = (a: string, b: string) => (a.trim() ? `${a.trim()} ${b}` : b).trim();
  const voice = input === "voice" && voicePossible;

  useEffect(() => {
    if (!voice) box.current?.focus({ preventScroll: true });
  }, [voice]);

  return (
    <div className="flex flex-col">
      {voice ? (
        <div className="flex flex-col items-center gap-3 pb-6">
          <PushToTalk
            size="lg"
            onListeningChange={(on) => {
              if (on) {
                before.current = value;
                setError(null);
              }
              setListening(on);
              onListening(on);
            }}
            onInterim={(t) => onChange(join(before.current, t))}
            onFinal={(t) => onChange(join(before.current, t))}
            onError={setError}
            onDictate={() => box.current?.focus()}
          />
          <p aria-live="polite" className="min-h-[1.375em] text-subhead text-label-2">
            {error ?? (listening ? "Listening. Let go when you're done." : "Hold and talk")}
          </p>
        </div>
      ) : null}
      <label htmlFor="answer" className="sr-only">
        {label}
      </label>
      <textarea
        id="answer"
        ref={box}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={voice ? 3 : 5}
        maxLength={1200}
        placeholder={voice ? "What I hear shows here. Fix anything I got wrong." : placeholder}
        className="w-full resize-none rounded-group bg-fill px-4 py-3 text-body text-label outline-none placeholder:text-label-2"
      />
      {voicePossible ? (
        <button
          type="button"
          onClick={() => onInput(voice ? "text" : "voice")}
          className="press mx-auto mt-2 flex h-11 items-center px-3 text-subhead font-semibold text-tint-text"
        >
          {voice ? "Noisy here? Type instead" : "Talk instead"}
        </button>
      ) : null}
    </div>
  );
}

// ---------- one heard goal on the review ----------

function HeardRow({ row, onChange }: { row: Row; onChange: (r: Row) => void }) {
  const sleep = row.target.kind === "target";
  // Sleep is set per night, everything else per week; stored per week either way.
  const value = sleep ? row.weekly_budget_minutes / 7 : row.weekly_budget_minutes;
  const step = 30;
  const [min, max] = sleep ? [5 * 60, 10 * 60] : [30, 50 * 60];
  const set = (v: number) => {
    const clamped = Math.min(max, Math.max(min, v));
    const weekly = sleep ? clamped * 7 : clamped;
    onChange({
      ...row,
      weekly_budget_minutes: weekly,
      estimated: false,
      target: sleep ? { ...row.target, sleep_hours: clamped / 60 } : row.target,
    });
  };
  const btn =
    "press grid size-9 place-items-center rounded-full bg-bg text-body font-semibold disabled:opacity-30";
  return (
    <div>
      <div className="flex min-h-14 items-start gap-3 px-4 py-3">
        <button
          type="button"
          aria-pressed={row.on}
          aria-label={`Keep ${row.title}`}
          onClick={() => onChange({ ...row, on: !row.on })}
          className="press -m-2 mt-[-6px] grid size-10 shrink-0 place-items-center rounded-full"
        >
          <Check on={row.on} />
        </button>
        <span className="flex min-w-0 flex-1 flex-col">
          <input
            value={row.title}
            onChange={(e) => onChange({ ...row, title: e.target.value.slice(0, 60) })}
            aria-label="Goal name"
            className="w-full bg-transparent text-body font-semibold text-label outline-none"
          />
          <span className="truncate text-footnote text-label-2">“{row.evidence}”</span>
        </span>
        <span className="shrink-0 pt-0.5 text-footnote text-label-2">{AREA_LABEL[row.category]}</span>
      </div>
      {row.on ? (
        <div className="flex items-center gap-3 pr-4 pb-3 pl-[52px]">
          <button
            type="button"
            className={btn}
            aria-label={`Less ${row.title}`}
            disabled={value <= min}
            onClick={() => set(value - step)}
          >
            <span aria-hidden="true">−</span>
          </button>
          <output aria-live="polite" className="min-w-[6.5rem] text-center font-num text-body font-bold tnum">
            {hm(value)} a {sleep ? "night" : "week"}
          </output>
          <button
            type="button"
            className={btn}
            aria-label={`More ${row.title}`}
            disabled={value >= max}
            onClick={() => set(value + step)}
          >
            <span aria-hidden="true">+</span>
          </button>
          {row.estimated ? (
            <span className="whitespace-nowrap text-footnote text-label-2">My estimate</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------- the talk ----------

export function Talk({ elevenlabs }: { elevenlabs: boolean }) {
  const router = useRouter();
  const mode = useSyncExternalStore(subscribeInputMode, currentInputMode, () => "recognition" as const);
  const voicePossible = mode !== "none";
  const [phase, setPhase] = useState<Phase>("intro");
  const [sound, setSound] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [introRun, setIntroRun] = useState(0);
  const [introPace, setIntroPace] = useState(SILENT_MS);
  const [q, setQ] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() => QUESTIONS.map(() => ""));
  const [input, setInput] = useState<Input>("voice");
  const [heard, setHeard] = useState<GoalWordsResponse | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState<{ text: string; on: boolean }[]>([]);
  const [more, setMore] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "skip" | "more" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  useEffect(() => {
    checkRecorderPath();
    return () => stopSpeaking();
  }, []);

  /** Michael says a line when his voice is on. Never awaited by the flow: the screen never waits on sound. */
  const say = useCallback(
    (text: string) => {
      stopSpeaking();
      if (!soundRef.current) return;
      setSpeaking(true);
      void speakReply(text, elevenlabs).finally(() => setSpeaking(false));
    },
    [elevenlabs],
  );

  // Each new question, or the review, moves focus to its heading and is said out loud.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a new step only
  useEffect(() => {
    if (phase === "intro") return;
    heading.current?.focus({ preventScroll: true });
    if (phase === "ask") {
      const question = QUESTIONS[q] as Question;
      say(`${question.ask} ${question.hint}`);
    }
    if (phase === "review" && heard) say(heard.line);
  }, [phase, q, heard]);

  function hearIntro() {
    primeSpeech();
    unlockAudio();
    setSound(true);
    soundRef.current = true;
    setIntroPace(SPOKEN_MS);
    setIntroRun((r) => r + 1);
    say(INTRO.join(" "));
  }

  function start() {
    // The tap that starts the talk is what lets the phone play his voice from here on.
    primeSpeech();
    unlockAudio();
    setSound(true);
    soundRef.current = true;
    if (!voicePossible) setInput("text");
    setPhase("ask");
  }

  async function hear(text: string): Promise<GoalWordsResponse | null> {
    return hearGoals(text).catch(() => null);
  }

  async function finishQuestions(final: string[]) {
    stopSpeaking();
    const text = final
      .map((a) => a.trim())
      .filter(Boolean)
      .join("\n");
    if (!text) {
      setHeard({
        goals: [],
        notes: [],
        line: "Tell me in a few words what you want more time for. Or pick from the usual.",
        source: "rules",
      });
      setRows([]);
      setNotes([]);
      setMore("");
      setPhase("review");
      return;
    }
    setPhase("hearing");
    const res = await hear(text);
    if (!res) {
      setFailed("I couldn't read that just now. Try again, or pick from the usual.");
      setHeard({ goals: [], notes: [], line: "Something went wrong on my side.", source: "rules" });
      setRows([]);
      setNotes([]);
      setPhase("review");
      return;
    }
    setFailed(null);
    setHeard(res);
    setRows(res.goals.map((g, i) => ({ ...g, key: `h${i}`, on: true })));
    setNotes(res.notes.map((text) => ({ text, on: true })));
    setMore(res.goals.length === 0 ? "" : null);
    setPhase("review");
  }

  function next(skip: boolean) {
    const final = skip ? answers.map((a, i) => (i === q ? "" : a)) : answers;
    if (skip) setAnswers(final);
    if (q < QUESTIONS.length - 1) {
      stopSpeaking();
      setQ(q + 1);
      return;
    }
    void finishQuestions(final);
  }

  async function addMore() {
    const text = (more ?? "").trim();
    if (!text) return;
    setBusy("more");
    setFailed(null);
    const res = await hear(text);
    setBusy(null);
    if (!res) {
      setFailed("I couldn't read that just now. Try once more.");
      return;
    }
    const known = new Set(rows.map((r) => r.title.toLowerCase()));
    const added = res.goals
      .filter((g) => !known.has(g.title.toLowerCase()))
      .map((g, i) => ({ ...g, key: `m${Date.now()}${i}`, on: true }));
    setRows((r) => [...r, ...added].slice(0, 5));
    setNotes((n) => [...n, ...res.notes.map((text) => ({ text, on: true }))].slice(0, 4));
    setHeard(res);
    setMore(added.length === 0 && rows.length === 0 ? "" : null);
  }

  async function keep() {
    stopSpeaking();
    setBusy("save");
    setFailed(null);
    const chosen = rows.filter((r) => r.on && r.title.trim());
    const res = await finishOnboarding({
      heard: chosen.map(({ key: _k, on: _o, ...g }) => ({ ...g, title: g.title.trim() })),
      notes: notes.filter((n) => n.on).map((n) => n.text),
    }).catch(() => ({ ok: false }));
    if (res.ok) {
      // Stays "Saving" until the next screen paints.
      router.push("/onboarding?step=connect");
      return;
    }
    setFailed("I couldn't save that. Nothing changed. Try again.");
    setBusy(null);
  }

  async function skipAll() {
    stopSpeaking();
    setBusy("skip");
    await skipOnboarding().catch(() => null);
    router.replace("/");
  }

  const michael: MichaelState =
    phase === "hearing" || busy === "more"
      ? "thinking"
      : listening
        ? "listening"
        : speaking
          ? "speaking"
          : phase === "review" && rows.length > 0
            ? "pleased"
            : "idle";

  const left = (
    <SoundButton
      on={sound}
      onChange={(on) => {
        if (on) unlockAudio();
        else stopSpeaking();
        soundRef.current = on;
        setSound(on);
      }}
    />
  );
  const right = (
    <button
      type="button"
      onClick={skipAll}
      disabled={busy !== null}
      className="press -mr-2 flex h-11 items-center px-2 text-body text-label-2"
    >
      Skip
    </button>
  );
  const face = <Michael state={michael} className="h-auto w-[52px] text-label" />;

  if (phase === "intro") {
    return (
      <OnboardingFrame
        step={0}
        progress={0}
        title={null}
        left={left}
        right={right}
        footer={
          <>
            <button type="button" onClick={start} className={primaryButton}>
              Let's talk
            </button>
            <button type="button" onClick={hearIntro} className={quietButton}>
              Hear it from me
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-8">
          {face}
          <AnimatedLines lines={INTRO} pace={introPace} run={introRun} />
        </div>
      </OnboardingFrame>
    );
  }

  if (phase === "ask") {
    const question = QUESTIONS[q] as Question;
    const value = answers[q] ?? "";
    const last = q === QUESTIONS.length - 1;
    return (
      <OnboardingFrame
        step={0}
        progress={(q + 1) / (QUESTIONS.length + 1)}
        title={null}
        left={left}
        right={right}
        footer={
          <>
            <button
              type="button"
              onClick={() => next(false)}
              disabled={!value.trim()}
              className={primaryButton}
            >
              {last ? "That's it" : "Next"}
            </button>
            <button type="button" onClick={() => next(true)} className={quietButton}>
              Skip this one
            </button>
          </>
        }
      >
        <div className="flex flex-col">
          {face}
          <h1
            ref={heading}
            tabIndex={-1}
            key={q}
            className="m-swap mt-6 text-large-title font-bold tracking-[0.01em] outline-none"
          >
            {question.ask}
          </h1>
          <p className="mt-2 text-body text-label-2">{question.hint}</p>
          <div className="mt-8">
            <Answer
              key={q}
              value={value}
              onChange={(v) => setAnswers((a) => a.map((x, i) => (i === q ? v : x)))}
              input={input}
              onInput={(i) => {
                stopSpeaking();
                setInput(i);
              }}
              voicePossible={voicePossible}
              onListening={(on) => {
                if (on) stopSpeaking();
                setListening(on);
              }}
              label="Your answer"
              placeholder="Type it as it comes. I'll sort it out."
            />
          </div>
        </div>
      </OnboardingFrame>
    );
  }

  if (phase === "hearing") {
    return (
      <OnboardingFrame
        step={0}
        progress={QUESTIONS.length / (QUESTIONS.length + 1)}
        title={null}
        left={left}
        right={right}
        footer={
          <button type="button" disabled aria-busy="true" className={primaryButton}>
            Reading
          </button>
        }
      >
        <div className="flex flex-col">
          {face}
          <h1
            ref={heading}
            tabIndex={-1}
            className="mt-6 text-large-title font-bold tracking-[0.01em] outline-none"
          >
            Give me a second.
          </h1>
          <p role="status" className="mt-2 text-body text-label-2">
            Reading what you said.
          </p>
        </div>
      </OnboardingFrame>
    );
  }

  // review
  const n = rows.filter((r) => r.on && r.title.trim()).length;
  return (
    <OnboardingFrame
      step={1}
      title={null}
      left={left}
      right={right}
      footer={
        <>
          {failed ? (
            <p role="alert" className="mb-3 text-center text-footnote text-danger">
              {failed}
            </p>
          ) : null}
          {rows.length > 0 ? (
            <button
              type="button"
              onClick={keep}
              disabled={n === 0 || busy !== null}
              aria-busy={busy === "save"}
              className={primaryButton}
            >
              {busy === "save" ? "Saving" : n === 0 ? "Pick at least one" : `Keep ${count(n)}`}
            </button>
          ) : (
            <Link href="/onboarding?step=goals" className={primaryButton}>
              Pick from the usual
            </Link>
          )}
        </>
      }
    >
      <div className="flex flex-col">
        {face}
        <h1
          ref={heading}
          tabIndex={-1}
          className="mt-6 text-large-title font-bold tracking-[0.01em] outline-none"
        >
          {rows.length > 0 ? "Here's what I heard." : "I need a little more."}
        </h1>
        {heard ? <p className="mt-2 text-body text-label-2">{heard.line}</p> : null}

        {rows.length > 0 ? (
          <ul aria-label="Goals I heard" className="mt-6 overflow-hidden rounded-group bg-fill">
            {rows.map((r, i) => (
              <li key={r.key} className="relative">
                {i > 0 ? <Separator inset={52} /> : null}
                <HeardRow
                  row={r}
                  onChange={(next) => setRows((all) => all.map((x) => (x.key === r.key ? next : x)))}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {notes.length > 0 ? (
          <section aria-label="What I'll remember" className="mt-8">
            <h2 className="mb-2 text-subhead text-label-2">What I'll remember about how you work</h2>
            <ul className="overflow-hidden rounded-group bg-fill">
              {notes.map((note, i) => (
                <li key={note.text} className="relative">
                  {i > 0 ? <Separator inset={52} /> : null}
                  <button
                    type="button"
                    aria-pressed={note.on}
                    onClick={() => setNotes((all) => all.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
                    className="press flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left"
                  >
                    <Check on={note.on} />
                    <span className="min-w-0 flex-1 text-body">{note.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="mt-6">
          {more === null ? (
            rows.length < 5 ? (
              <button type="button" onClick={() => setMore("")} className={quietButton}>
                I missed something
              </button>
            ) : null
          ) : (
            <div className="flex flex-col gap-2">
              <Answer
                value={more}
                onChange={setMore}
                input={input}
                onInput={setInput}
                voicePossible={voicePossible}
                onListening={(on) => {
                  if (on) stopSpeaking();
                  setListening(on);
                }}
                label="Anything I missed"
                placeholder="Anything I missed, in your own words"
              />
              <button
                type="button"
                onClick={addMore}
                disabled={!more.trim() || busy !== null}
                aria-busy={busy === "more"}
                className="press mx-auto flex h-11 items-center rounded-full bg-tint/14 px-5 text-subhead font-semibold text-tint-text disabled:opacity-40"
              >
                {busy === "more" ? "Reading" : "Add it"}
              </button>
            </div>
          )}
        </div>
      </div>
    </OnboardingFrame>
  );
}
