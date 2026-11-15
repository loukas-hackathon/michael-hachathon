"use client";

import type { GoalArea, GoalWordsResponse, HeardGoal, OnboardingTurn } from "@michael/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Michael, type MichaelState } from "@/components/michael";
import { useArrival } from "@/components/motion";
import { listenTurn, type Turn, type TurnError } from "@/components/voice/listen-turn";
import {
  checkRecorderPath,
  currentInputMode,
  primeRecorder,
  releaseMic,
  subscribeInputMode,
} from "@/components/voice/recorder";
import { primeSpeech, speakReply, stopSpeaking, unlockAudio } from "@/components/voice/speech";
import { hm } from "@/lib/format";
import { SCRIPT_DONE, scriptTurn, splitLine, userWords, withoutGreeting } from "@/lib/onboarding-script";
import { finishOnboarding, hearGoals, nextTurn, skipOnboarding } from "./actions";
import { MichaelWaits, OnboardingFrame, primaryButton, quietButton, Separator } from "./frame";
import { Check } from "./goals-step";
import { ReadingStatus, useShown } from "./reading-status";
import { MicIcon, type TalkState, VoiceOrb } from "./voice-orb";
import { type WaitKind, WaitScreen } from "./wait";

// Getting started is a conversation with Michael, hands free (Loukas, Sun 15 Nov). The first tap
// plays his voice, his intro lighting up as he says it. Then, unless the calendar is already in,
// one question: look at the calendar first, so he can ask about the real week. Then the talk: he
// says a line, listens on his own, shows the user's words as they come, notices the pause, and
// answers with a follow up. His lines come from POST /v1/onboarding/turn; when that cannot answer
// (not deployed, no model, slow) his own script of three questions stands in. When he has enough,
// the API reads everything the user said into goals with weekly hours, and the review shows what
// he heard, each goal with the user's own words under it. Nothing is saved until the user keeps it.
// Escape hatches stay one tap away and never in the way: type instead, skip a question, mute the
// microphone, fix a misheard answer by tapping it. No microphone, or none allowed: typing, said kindly.

const INTRO = [
  "I'm Michael.",
  "I find the time you lose every day and give it back to your goals.",
  "Tell me what you're working towards. I'll learn how your days really go, and tell you what to fix.",
];

const CALENDAR_ASK = "Want me to look at your calendar first?";
const CALENDAR_WHY = "I'll ask about your real week.";

// Under the text box, whose placeholder already says "Type it as it comes": short, never repeated.
const NO_MIC = "I can't hear you on this device. We'll type.";
const QUIET = "Take your time. Tap me when you're ready.";
const ERROR_COPY: Record<TurnError, string> = {
  "not-allowed": "No microphone, no problem. We'll type.",
  "audio-capture": "I can't find a microphone. We'll type.",
  "no-voice": "I can't listen in this browser. We'll type.",
  failed: "I lost you for a second. Type it, or tap Talk instead.",
};

// While he thinks of his next line (up to TURN_WAIT_MS): plain words that move on, never a frozen
// screen. The first line has nothing of the user's to think about yet.
const FIRST_THOUGHT = ["Thinking where to start", "Nearly ready"];
const NEXT_THOUGHT = ["Thinking it over", "Still with you", "One more second"];
// Reading the whole talk into goals.
const HEARING = ["Reading what you said", "Finding your goals", "Working out the hours"];
// Skip: on the way to Today.
const SKIPPING = ["Getting your day ready"];

const AREA_LABEL: Record<GoalArea, string> = { business: "Business", health: "Health", personal: "Personal" };

/** Milliseconds per word for the intro: quick when silent, his pace when the length is unknown. */
const SILENT_MS = 55;
const SPOKEN_MS = 360;
/** The API gets this long for his next line; then the script answers. */
const TURN_WAIT_MS = 10_000;
/** The contract keeps at most 24 turns: wrap up before that. */
const MAX_TURNS = 22;

type Phase = "intro" | "calendar" | "ready" | "talk" | "hearing" | "review";
type Input = "voice" | "text";
type Row = HeardGoal & { key: string; on: boolean };
/** A misheard answer being fixed: the one still being said, or one already sent. */
type Editing = { at: "live" | number; text: string };

const count = (n: number) =>
  n === 1 ? "this goal" : n === 2 ? "these two" : n === 3 ? "these three" : `these ${n}`;

const wordCount = (lines: string[]) => lines.join(" ").split(/\s+/).filter(Boolean).length;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

// ---------- the intro: his words arrive, or light up as he says them ----------

/** null: arrive once, quickly. pace null: dimmed, waiting for his voice. pace: lit at that pace. */
type Lit = { run: number; pace: number | null } | null;

function IntroLines({ lines, lit }: { lines: string[]; lit: Lit }) {
  let i = 0;
  const pace = lit ? (lit.pace ?? 0) : SILENT_MS;
  const cls = !lit ? "m-word-in" : lit.pace === null ? "m-word-wait" : "m-word-lit";
  return (
    <div key={`${lit?.run ?? 0}-${cls}`} className="flex flex-col gap-3">
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
                  <span
                    className={`${cls} inline-block`}
                    style={cls === "m-word-wait" ? undefined : { animationDelay: `${delay}ms` }}
                  >
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

// ---------- Michael thinking, in words that move on ----------

/** The shared thinking pattern (components/thinking.tsx), with a line that moves on as it lasts. */
function ThinkingLine({
  steps,
  className = "",
  live = false,
}: {
  steps: string[];
  className?: string;
  live?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span aria-hidden="true" className="block w-[15px] shrink-0">
        <Michael state="thinking" className="block h-auto w-full" />
      </span>
      <ReadingStatus steps={steps} every={3000} live={live} />
    </span>
  );
}

// ---------- the sound switch: Michael's voice ----------

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

// scroll-mb: a focused box scrolls clear of the pinned action, never under it.
const textBox =
  "w-full scroll-mb-28 resize-none rounded-group bg-fill px-4 py-3 text-body text-label outline-none placeholder:text-label-2";
const tintedButton =
  "press flex h-11 items-center rounded-full bg-tint/14 px-5 text-subhead font-semibold text-tint-text disabled:opacity-40";
const controlButton =
  "press flex h-11 items-center gap-1.5 px-3 text-subhead font-semibold text-label-2 disabled:opacity-40";

export function Talk({
  elevenlabs,
  calendar,
  back,
  calendarHref,
}: {
  elevenlabs: boolean;
  /** Google Calendar is already connected: no need to ask. */
  calendar: boolean;
  /** Straight back from Google: one tap starts the talk (a phone needs a fresh tap for sound). */
  back: "connected" | "failed" | null;
  calendarHref: string;
}) {
  const router = useRouter();
  const mode = useSyncExternalStore(subscribeInputMode, currentInputMode, () => "recognition" as const);
  const voicePossible = mode !== "none";

  const [phase, setPhase] = useState<Phase>(back ? "ready" : "intro");
  // The screen the talk opened on stays still; every screen a tap brings in arrives (frame.tsx).
  const [opened] = useState(phase);
  const [sound, setSound] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [lit, setLit] = useState<Lit>(null);
  const [introStarted, setIntroStarted] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // The conversation.
  const [turns, setTurns] = useState<OnboardingTurn[]>([]);
  const [line, setLine] = useState("");
  const [talk, setTalk] = useState<TalkState>("thinking");
  const [live, setLive] = useState("");
  const [level, setLevel] = useState(0);
  const [recorded, setRecorded] = useState(false);
  const [spoke, setSpoke] = useState(false);
  const [muted, setMuted] = useState(false);
  const [input, setInput] = useState<Input>("voice");
  const [note, setNote] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);

  // The review.
  const [heard, setHeard] = useState<GoalWordsResponse | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState<{ text: string; on: boolean; added?: boolean }[]>([]);
  const [more, setMore] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "skip" | "more" | null>(null);
  // On the way to another step: the button's pending word first, then Michael thinking (wait.tsx).
  const [going, setGoing] = useState<WaitKind | null>(null);
  const goingShown = useShown(going !== null);
  const [failed, setFailed] = useState<string | null>(null);

  const heading = useRef<HTMLHeadingElement>(null);
  const answerBox = useRef<HTMLTextAreaElement>(null);
  // Read inside async callbacks, where state would be stale.
  const soundRef = useRef(sound);
  const inputRef = useRef(input);
  const mutedRef = useRef(muted);
  const editingRef = useRef(editing);
  const turnsRef = useRef(turns);
  soundRef.current = sound;
  inputRef.current = input;
  mutedRef.current = muted;
  editingRef.current = editing;
  turnsRef.current = turns;
  // Bumped whenever the talk moves on, so a late answer, speech end or turn is ignored.
  const gen = useRef(0);
  const turn = useRef<Turn | null>(null);

  useEffect(() => {
    checkRecorderPath();
    return () => {
      gen.current++;
      turn.current?.cancel();
      stopSpeaking();
      releaseMic();
    };
  }, []);

  // Back from Google (or Today) with the browser's Back: the page comes from the cache, so a
  // pending "Connecting" or "Saving" would otherwise stay on.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setConnecting(false);
      setBusy(null);
      setGoing(null);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  // Where a tap from here can lead, fetched ahead, so the screen after lands at once.
  useEffect(() => {
    router.prefetch("/onboarding?step=connect");
    router.prefetch("/onboarding?step=goals");
    router.prefetch("/");
  }, [router]);

  // His thinking line shows once a wait passes a quarter second, and then stays long enough to read.
  const thinkingShown = useShown(phase === "talk" && talk === "thinking");
  const arriving = useArrival();

  /** Michael says a line when his voice is on; resolves when he has said it or was cut short. */
  const say = useCallback(
    async (text: string) => {
      stopSpeaking();
      if (!soundRef.current) return;
      setSpeaking(true);
      await speakReply(text, elevenlabs).finally(() => setSpeaking(false));
    },
    [elevenlabs],
  );

  // A new step, a new line or the review: focus its heading (no ring: tabIndex -1).
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a new step or line only
  useEffect(() => {
    if (phase === "intro") return;
    heading.current?.focus({ preventScroll: true });
    if (phase === "review" && heard) void say(heard.line);
  }, [phase, line, heard]);

  // Typing: the box gets the keyboard as soon as it is there.
  useEffect(() => {
    if (phase === "talk" && input === "text" && !editing) answerBox.current?.focus({ preventScroll: true });
  }, [phase, input, editing]);

  function cancelTurn() {
    turn.current?.cancel();
    turn.current = null;
    setLevel(0);
  }

  // ----- the intro -----

  function introTap() {
    if (introStarted) return goOn();
    // Inside the first tap: from here on the phone lets him speak, and the meter may run.
    primeSpeech();
    unlockAudio();
    primeRecorder();
    checkRecorderPath();
    setIntroStarted(true);
    if (!soundRef.current) return goOn();
    const mine = ++gen.current;
    const run = (lit?.run ?? 0) + 1;
    const units = wordCount(INTRO) + INTRO.length * 2;
    let started = false;
    const begin = (ms: number | null) => {
      if (started || mine !== gen.current) return;
      started = true;
      setLit({ run, pace: ms ? (ms * 0.94) / units : SPOKEN_MS });
    };
    setLit({ run, pace: null });
    // Never left dimmed: if the voice gives no start signal, the words go at his usual pace.
    const fallback = setTimeout(() => begin(null), 1500);
    setSpeaking(true);
    void speakReply(INTRO.join(" "), elevenlabs, { onStart: begin }).finally(() => {
      clearTimeout(fallback);
      setSpeaking(false);
      if (mine === gen.current) goOn();
    });
  }

  function goOn() {
    gen.current++;
    stopSpeaking();
    if (calendar) return beginTalk();
    setPhase("calendar");
    void say(`${CALENDAR_ASK} ${CALENDAR_WHY}`);
  }

  // ----- the conversation -----

  /** Starts the talk. Called from a tap where it can be, so the phone allows his voice and the mic. */
  function beginTalk() {
    unlockAudio();
    primeRecorder();
    checkRecorderPath();
    stopSpeaking();
    if (currentInputMode() === "none") {
      setInput("text");
      inputRef.current = "text";
      setNote(NO_MIC);
    }
    setPhase("talk");
    turnsRef.current = [];
    setTurns([]);
    void ask([]);
  }

  /** Gets Michael's next line (the API, else the script), says it, then listens. */
  async function ask(so: OnboardingTurn[]) {
    const mine = ++gen.current;
    setTalk("thinking");
    setLive("");
    if (so.length >= MAX_TURNS) return finish(so, SCRIPT_DONE);
    const got = (await withTimeout(nextTurn(so), TURN_WAIT_MS, null)) ?? scriptTurn(so);
    const res = { ...got, line: withoutGreeting(got.line) };
    if (mine !== gen.current) return;
    const next: OnboardingTurn[] = [...so, { role: "michael", text: res.line }];
    turnsRef.current = next;
    setTurns(next);
    setLine(res.line);
    if (res.done) return finish(next, res.line);
    if (soundRef.current) {
      setTalk("speaking");
      await say(res.line);
      if (mine !== gen.current) return;
    }
    listen(mine);
  }

  /** Listens for the user's answer, hands free, unless they type, muted the mic or are fixing a line. */
  function listen(mine = gen.current) {
    if (mine !== gen.current) return;
    cancelTurn();
    if (inputRef.current === "text" || mutedRef.current || editingRef.current) {
      setTalk("waiting");
      return;
    }
    const how = currentInputMode();
    if (how === "none") return toText(NO_MIC);
    setRecorded(how === "recorder");
    setTalk("listening");
    setLive("");
    setSpoke(false);
    setNote(null);
    const t = listenTurn(
      {
        onWords: (text) => {
          if (mine === gen.current) setLive(text);
        },
        // A recording shows no words until it is text: this is how the screen knows they talk.
        onSpeech: () => {
          if (mine === gen.current) setSpoke(true);
        },
        onLevel: (l) => {
          if (mine === gen.current) setLevel(l);
        },
        onTranscribing: () => {
          if (mine === gen.current) setTalk("transcribing");
        },
        onDone: (text) => {
          if (turn.current === t) turn.current = null;
          if (mine !== gen.current) return;
          // Only noise: listen on.
          if (text.trim()) submit(text);
          else listen(mine);
        },
        onQuiet: () => {
          if (turn.current === t) turn.current = null;
          if (mine !== gen.current) return;
          setTalk("waiting");
          setNote(QUIET);
        },
        onError: (e) => {
          if (turn.current === t) turn.current = null;
          if (mine === gen.current) toText(ERROR_COPY[e]);
        },
      },
      { mode: how },
    );
    turn.current = t;
  }

  /** The rest of the talk by keyboard, with one kind line saying why. */
  function toText(why: string | null) {
    cancelTurn();
    inputRef.current = "text";
    setInput("text");
    setNote(why);
    setTalk((s) => (s === "listening" || s === "transcribing" ? "waiting" : s));
  }

  /** The user's turn is in: said, typed, fixed or skipped. */
  function submit(text: string, skipped = false) {
    cancelTurn();
    stopSpeaking();
    const said: OnboardingTurn = skipped
      ? { role: "user", text: "", skipped: true }
      : { role: "user", text: text.trim().slice(0, 1200) };
    const next = [...turnsRef.current, said];
    turnsRef.current = next;
    setTurns(next);
    setLive("");
    setDraft("");
    editingRef.current = null;
    setEditing(null);
    setNote(null);
    void ask(next);
  }

  /** Michael has enough: read everything the user said into goals, then the review. */
  async function finish(so: OnboardingTurn[], last: string) {
    cancelTurn();
    const mine = ++gen.current;
    setPhase("hearing");
    void say(last);
    const text = userWords(so);
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
    const res = await hearGoals(text).catch(() => null);
    if (mine !== gen.current) return;
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

  /** The orb does the one obvious thing: cut in, done talking, or listen again. */
  function tapOrb() {
    primeRecorder();
    if (talk === "speaking") {
      stopSpeaking();
    } else if (talk === "listening") {
      // Always: a recording whose level never rose (a quiet voice, a broken meter) still ends here.
      turn.current?.finish();
    } else if (talk === "waiting" && input === "voice") {
      if (muted) {
        mutedRef.current = false;
        setMuted(false);
      }
      setNote(null);
      listen();
    }
  }

  function toggleMute() {
    const on = !muted;
    mutedRef.current = on;
    setMuted(on);
    if (on) {
      if (talk === "listening") {
        cancelTurn();
        setLive("");
        setTalk("waiting");
      }
    } else if (talk === "waiting" || talk === "listening") {
      primeRecorder();
      listen();
    }
  }

  function typeInstead() {
    toText(null);
    setDraft(live);
    setLive("");
  }

  function talkInstead() {
    primeRecorder();
    inputRef.current = "voice";
    setInput("voice");
    setNote(null);
    if (talk === "waiting") listen();
  }

  /** Tap a line to fix it: the one being said (stops listening) or the last one sent. */
  function startEditing(at: Editing["at"], text: string) {
    if (at === "live" || talk === "listening") {
      cancelTurn();
      setLive("");
      setTalk((s) => (s === "listening" ? "waiting" : s));
    }
    const e = { at, text };
    editingRef.current = e;
    setEditing(e);
  }

  function saveEdit() {
    const e = editing;
    if (!e) return;
    editingRef.current = null;
    setEditing(null);
    if (e.at === "live") {
      if (e.text.trim()) submit(e.text);
      else listen();
      return;
    }
    const at = e.at;
    const next = turnsRef.current.map((t, i) =>
      i === at ? { ...t, text: e.text.trim().slice(0, 1200), skipped: e.text.trim() ? undefined : true } : t,
    );
    turnsRef.current = next;
    setTurns(next);
    if (talk === "waiting" && input === "voice" && !muted) listen();
  }

  function cancelEdit() {
    const e = editing;
    editingRef.current = null;
    setEditing(null);
    if (e && talk === "waiting" && input === "voice" && !muted) listen();
  }

  // ----- the review -----

  async function addMore() {
    const text = (more ?? "").trim();
    if (!text) return;
    setBusy("more");
    setFailed(null);
    const res = await hearGoals(text).catch(() => null);
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
    setNotes((n) => [...n, ...res.notes.map((text) => ({ text, on: true, added: true }))].slice(0, 4));
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
      setGoing("connect");
      router.push("/onboarding?step=connect");
      return;
    }
    setFailed("I couldn't save that. Nothing changed. Try again.");
    setBusy(null);
  }

  async function skipAll() {
    gen.current++;
    cancelTurn();
    stopSpeaking();
    setBusy("skip");
    await skipOnboarding().catch(() => null);
    router.replace("/");
  }

  // ----- the frame -----

  const left = (
    <SoundButton
      on={sound}
      onChange={(on) => {
        if (on) unlockAudio();
        else {
          // Silencing the intro keeps it on screen rather than moving on.
          if (phase === "intro") {
            gen.current++;
            setLit(null);
          }
          stopSpeaking();
        }
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
  const face = (state: MichaelState) => <Michael state={state} className="h-auto w-[52px] text-label" />;
  // A screen a tap brought in arrives in one moment; the one the talk opened on stays still.
  const screen = phase === opened ? undefined : phase;

  if (going && goingShown) return <WaitScreen kind={going} screen={`to-${going}`} />;

  if (busy === "skip") {
    // Skip answers at once: Michael on his way out, while the skip is saved and Today loads.
    return (
      <OnboardingFrame step={0} progress={0} title={null} left={left} screen="leaving" footer={null}>
        <MichaelWaits title="Taking you to Today." status={<ReadingStatus steps={SKIPPING} />} />
      </OnboardingFrame>
    );
  }

  if (phase === "intro") {
    return (
      <OnboardingFrame
        step={0}
        progress={0}
        title={null}
        left={left}
        right={right}
        screen={screen}
        footer={
          <button type="button" onClick={introTap} className={primaryButton}>
            {introStarted ? "Continue" : "Let's talk"}
          </button>
        }
      >
        <div className="flex flex-col gap-8">
          {/* Between the tap and his first word (his voice loading) he is visibly thinking. */}
          {face(speaking ? (lit?.pace === null ? "thinking" : "speaking") : "idle")}
          <IntroLines lines={INTRO} lit={lit} />
        </div>
      </OnboardingFrame>
    );
  }

  if (phase === "calendar" || phase === "ready") {
    const ready = phase === "ready";
    const title = !ready
      ? CALENDAR_ASK
      : back === "failed"
        ? "Your calendar didn't connect."
        : "Got your calendar.";
    const sub = !ready
      ? CALENDAR_WHY
      : back === "failed"
        ? "We can talk anyway, and add it after."
        : "I've read your last four weeks. Tap when you're ready to talk.";
    return (
      <OnboardingFrame
        step={0}
        progress={0.1}
        title={null}
        left={left}
        right={right}
        screen={screen}
        footer={
          ready ? (
            <>
              <button type="button" onClick={beginTalk} className={primaryButton}>
                Start talking
              </button>
              {back === "failed" ? (
                <a href={calendarHref} className={`${quietButton} w-fit`}>
                  Try again
                </a>
              ) : null}
            </>
          ) : (
            <>
              <a
                href={calendarHref}
                onClick={() => {
                  gen.current++;
                  stopSpeaking();
                  setConnecting(true);
                }}
                aria-busy={connecting}
                className={`${primaryButton} ${connecting ? "pointer-events-none opacity-60" : ""}`}
              >
                {connecting ? "Connecting" : "Connect Google Calendar"}
              </a>
              <button type="button" onClick={beginTalk} disabled={connecting} className={quietButton}>
                Not now
              </button>
            </>
          )
        }
      >
        <div className="flex flex-col">
          {face(
            connecting ? "thinking" : speaking ? "speaking" : ready && back !== "failed" ? "pleased" : "idle",
          )}
          <h1
            ref={heading}
            tabIndex={-1}
            className="mt-6 text-large-title font-bold tracking-[0.01em] outline-none"
          >
            {title}
          </h1>
          <p className="mt-2 min-h-[1.375em] text-body text-label-2">
            {/* Google can take a moment to open: say so where the reason was. */}
            {connecting ? (
              <span key="opening" role="status" className="m-swap">
                Opening Google
              </span>
            ) : (
              sub
            )}
          </p>
        </div>
      </OnboardingFrame>
    );
  }

  if (phase === "talk") {
    const answered = turns.filter((t) => t.role === "user").length;
    const lastAt = turns.findLastIndex((t) => t.role === "user" && !t.skipped && t.text);
    const lastSent =
      lastAt >= 0 && lastAt === turns.length - 1 - (talk === "thinking" ? 0 : 1) ? turns[lastAt] : null;
    const thinking = talk === "thinking" || talk === "transcribing";
    const said = splitLine(line);
    const listening = talk === "listening" && !muted;
    const orbLabel =
      talk === "speaking"
        ? "Tap to answer now"
        : talk === "listening"
          ? live.trim() || spoke
            ? "Tap when you're done"
            : recorded
              ? "Listening. Tap when you're done"
              : "Listening"
          : talk === "thinking"
            ? "Thinking"
            : talk === "transcribing"
              ? "Reading what you said"
              : muted
                ? "Muted. Tap to listen"
                : input === "voice"
                  ? "Tap to talk"
                  : "Michael";
    const status =
      talk === "transcribing"
        ? "Reading what you said."
        : muted && input === "voice"
          ? "Muted. I'm not listening."
          : (note ??
            (listening
              ? live.trim()
                ? "I'll answer when you pause. Tap your words to fix them."
                : spoke
                  ? "I'll answer when you pause, or tap me."
                  : recorded
                    ? "I'm listening. Pause or tap me when you're done."
                    : "I'm listening. Take your time."
              : null));

    return (
      <OnboardingFrame
        step={0}
        progress={Math.min(0.9, 0.2 + answered * 0.25)}
        title={null}
        left={left}
        right={right}
        screen={screen}
        footer={
          input === "text" ? (
            <>
              <button
                type="button"
                onClick={() => submit(draft)}
                disabled={!draft.trim() || thinking || editing !== null}
                className={primaryButton}
              >
                Send
              </button>
              <div className="mt-1 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => submit("", true)}
                  disabled={thinking}
                  className={controlButton}
                >
                  Skip this one
                </button>
                {voicePossible ? (
                  <button type="button" onClick={talkInstead} className={controlButton}>
                    Talk instead
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-pressed={muted}
                onClick={toggleMute}
                className={`${controlButton} -ml-3`}
              >
                <MicIcon off={muted} className="size-[18px]" />
                {muted ? "Unmute" : "Mute"}
              </button>
              <button
                type="button"
                onClick={() => submit("", true)}
                disabled={thinking}
                className={controlButton}
              >
                Skip this one
              </button>
              <button type="button" onClick={typeInstead} className={`${controlButton} -mr-3`}>
                Type instead
              </button>
            </div>
          )
        }
      >
        <div className="flex flex-col items-center text-center">
          <VoiceOrb
            state={talk}
            muted={muted && input === "voice"}
            recorded={recorded}
            level={level}
            words={live.trim() ? live.trim().split(/\s+/).length : 0}
            label={orbLabel}
            onTap={tapOrb}
            disabled={thinking}
          />
          {/* His line, read at a glance: the question bold, the reaction and the hint quiet around it.
              Before his first line, the same room says he is thinking where to start. */}
          {line ? (
            <div
              key={line}
              aria-live="polite"
              data-testid="michael-line"
              className="m-swap mt-6 flex min-h-[5.5rem] max-w-[32ch] flex-col items-center justify-start"
            >
              {/* Dims while he thinks of the next one: the answer is in, he has moved on. */}
              <div
                data-dim={talk === "thinking" ? "" : undefined}
                className="m-dim flex flex-col items-center"
              >
                {said.before ? <p className="mb-1 text-body text-label-2">{said.before}</p> : null}
                <h1 ref={heading} tabIndex={-1} className="text-insight font-bold text-balance outline-none">
                  {said.ask}
                </h1>
                {said.after ? <p className="mt-2 text-body text-balance text-label-2">{said.after}</p> : null}
              </div>
            </div>
          ) : (
            <div className="mt-6 flex min-h-[5.5rem] items-start justify-center">
              {thinkingShown ? (
                <ThinkingLine live steps={FIRST_THOUGHT} className="m-swap text-body text-label-2" />
              ) : null}
            </div>
          )}

          <div className="mt-6 flex w-full flex-col items-center">
            {editing ? (
              <div className="flex w-full flex-col gap-2">
                <label htmlFor="fix" className="sr-only">
                  Fix what I heard
                </label>
                <textarea
                  id="fix"
                  // biome-ignore lint/a11y/noAutofocus: the user just tapped their words to fix them
                  autoFocus
                  value={editing.text}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                  rows={3}
                  maxLength={1200}
                  className={`${textBox} text-left`}
                />
                <div className="flex items-center justify-center gap-2">
                  <button type="button" onClick={cancelEdit} className={controlButton}>
                    Cancel
                  </button>
                  <button type="button" onClick={saveEdit} className={tintedButton}>
                    {editing.at === "live" ? "Send" : "Save"}
                  </button>
                </div>
              </div>
            ) : live.trim() ? (
              <button
                type="button"
                onClick={() => startEditing("live", live)}
                aria-label={`You said: ${live}. Tap to fix.`}
                data-testid="live-words"
                className="press max-w-full rounded-group bg-fill px-4 py-3 text-left text-body text-label"
              >
                <span aria-live="polite">{live}</span>
              </button>
            ) : lastSent ? (
              <button
                type="button"
                onClick={() => startEditing(lastAt, lastSent.text)}
                disabled={thinking}
                aria-label={`You said: ${lastSent.text}. Tap to fix.`}
                // Quiet and labelled: the last answer, kept to fix, never read as an answer to the new question.
                className="press max-w-full rounded-control px-3 py-2 text-footnote text-label-2"
              >
                <span className="line-clamp-2">
                  You said “{lastSent.text}” <span className="font-semibold text-tint-text">Fix</span>
                </span>
              </button>
            ) : null}

            {input === "text" && !editing ? (
              <div className="mt-3 w-full">
                <label htmlFor="answer" className="sr-only">
                  Your answer
                </label>
                <textarea
                  id="answer"
                  ref={answerBox}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && draft.trim() && !thinking) {
                      e.preventDefault();
                      submit(draft);
                    }
                  }}
                  rows={4}
                  maxLength={1200}
                  placeholder="Type it as it comes. I'll sort it out."
                  className={`${textBox} text-left`}
                />
              </div>
            ) : null}

            <p role="status" className="mt-3 min-h-[1.125rem] text-footnote text-label-2">
              {/* Every wait says what he is doing, in words, so it reads under reduced motion too. */}
              {talk === "transcribing" ? (
                <ThinkingLine
                  key="reading"
                  steps={["Reading what you said", "Nearly there"]}
                  className="m-swap"
                />
              ) : status ? (
                <span key={status} className="m-swap">
                  {status}
                </span>
              ) : line && thinkingShown ? (
                <ThinkingLine key="thinking" steps={NEXT_THOUGHT} className="m-swap" />
              ) : null}
            </p>
          </div>
        </div>
      </OnboardingFrame>
    );
  }

  if (phase === "hearing") {
    return (
      <OnboardingFrame
        step={0}
        progress={0.95}
        title={null}
        left={left}
        right={right}
        screen={screen}
        // Room for the review's action, so nothing jumps when it lands.
        footer={<div aria-hidden="true" className="h-[50px]" />}
      >
        <MichaelWaits
          headingRef={heading}
          title="Give me a second."
          status={<ReadingStatus steps={HEARING} every={2500} />}
        />
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
      screen={screen}
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
            <Link href="/onboarding?step=goals" onClick={() => setGoing("goals")} className={primaryButton}>
              Pick from the usual
            </Link>
          )}
        </>
      }
    >
      <div className="flex flex-col">
        {face(busy !== null ? "thinking" : speaking ? "speaking" : rows.length > 0 ? "pleased" : "idle")}
        <h1
          ref={heading}
          tabIndex={-1}
          className="mt-6 text-large-title font-bold tracking-[0.01em] outline-none"
        >
          {rows.length > 0 ? "Here's what I heard." : "I need a little more."}
        </h1>
        {heard ? (
          <p key={heard.line} className="m-swap mt-2 text-body text-label-2">
            {heard.line}
          </p>
        ) : null}

        {rows.length > 0 ? (
          <ul aria-label="Goals I heard" className="mt-6 overflow-hidden rounded-group bg-fill">
            {rows.map((r, i) => (
              // A goal added with "Add it" pops in where it lands; the first ones arrive with the screen.
              <li
                key={r.key}
                className={`relative ${r.key.startsWith("m") && arriving(r.key) ? "m-pop-in" : ""}`}
              >
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
                <li
                  key={note.text}
                  className={`relative ${note.added && arriving(note.text) ? "m-pop-in" : ""}`}
                >
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
            <div className="m-pop-in flex flex-col gap-2" style={{ "--m-origin": "50% 0" } as CSSProperties}>
              <label htmlFor="more" className="sr-only">
                Anything I missed
              </label>
              <textarea
                id="more"
                // biome-ignore lint/a11y/noAutofocus: the user just tapped "I missed something" to type it
                autoFocus={rows.length > 0}
                value={more}
                onChange={(e) => setMore(e.target.value)}
                rows={3}
                maxLength={1200}
                placeholder="Anything I missed, in your own words"
                className={textBox}
              />
              <button
                type="button"
                onClick={addMore}
                disabled={!more.trim() || busy !== null}
                aria-busy={busy === "more"}
                className={`${tintedButton} mx-auto`}
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
