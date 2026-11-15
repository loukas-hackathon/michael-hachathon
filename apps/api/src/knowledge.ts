import {
  type Instruction,
  type Knowledge,
  type KnowledgeItem,
  type KnowledgeSource,
  type Profile,
  Source,
  type WeakSpot,
  type Weekday,
} from "@michael/shared";
import { agentsStore } from "./agents-store";
import { listMemories } from "./memory";
import { decide, toPrivacyState } from "./privacy";
import { athensMidnight } from "./routes/agents";
import { store } from "./store";

// "What I know about you" (#379): everything Michael uses about the user, in plain words, read
// from the stores that already hold it. No table of its own, so nothing here can drift from what
// the chat, the analysis and the agents actually read. Scoped like every store read.

const DAY_MS = 86_400_000;
// Check in answers older than this have been rolled into totals by retention anyway.
const CHECK_IN_DAYS = 90;
const MAX_MEMORIES = 200;
const MAX_CHECK_INS = 60;

// Each line is true to the code: voice (routes/voice.ts, transcribe.ts), Omi (ingest/omi.ts) and
// Google Calendar (integrations/calendar-sync.ts). Change the code, change the line.
export const NEVER_KEPT = [
  "Your voice. I turn it into words and drop the recording at once.",
  "Conversations word for word. I keep a short summary and your own to do items.",
  "Who else is in your meetings. I keep a count, never their names or emails.",
] as const;

// What the user calls each source, and what it sends, in one line. Manual and agent are not
// connections: they are the user and the agents the user approved.
const SOURCE_COPY: Partial<Record<Source, [name: string, sends: string]>> = {
  google_calendar: ["Google Calendar", "Your plans and meetings: titles, times and places"],
  health_auto_export: ["Apple Watch", "Sleep, workouts and heart rate"],
  whoop: ["WHOOP", "Sleep, strain and recovery"],
  macos_usage: ["Mac apps", "Which apps you use, and for how long"],
  chrome: ["Chrome", "Sites you spend time on, never what you type"],
  claude_code: ["Claude Code", "Work sessions and prompt titles"],
  activitywatch: ["ActivityWatch", "Computer activity"],
  iphone_usage: ["Screen Time", "iPhone apps by the day"],
  ios_shortcuts: ["Shortcuts", "Live app opens from your iPhone"],
  omi: ["Omi", "Meeting summaries you started, never the audio"],
  owntracks: ["OwnTracks", "Where you are, while it is on"],
  maps: ["Travel times", "Traffic between your saved places and plans"],
};
const NOT_A_CONNECTION: ReadonlySet<Source> = new Set<Source>(["manual", "agent"]);

const WEAK_SPOT_COPY: Record<WeakSpot, string> = {
  phone_in_bed: "Your phone in bed",
  late_nights: "Late nights",
  context_switching: "Switching between tasks",
  skipped_lunch: "Skipping lunch",
  doomscrolling: "Endless scrolling",
  back_to_back_meetings: "Back to back meetings",
  inbox_all_day: "The inbox all day",
  late_caffeine: "Late coffee",
};

const DAY_NAMES: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
const ORDER: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** "Mon to Fri", "Mon, Wed and Fri", "every day". */
export function daysPhrase(days: Weekday[]): string {
  const sorted = ORDER.filter((d) => days.includes(d));
  if (sorted.length === 7) return "every day";
  const idx = sorted.map((d) => ORDER.indexOf(d));
  const run = idx.length > 2 && idx.every((v, i) => i === 0 || v === (idx[i - 1] as number) + 1);
  const names = sorted.map((d) => DAY_NAMES[d]);
  if (run) return `${names[0]} to ${names.at(-1)}`;
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The profile as plain lines. Only once the user saved it: defaults are not something they told me. */
export function profileItems(p: Profile | null): KnowledgeItem[] {
  if (!p?.updated_at) return [];
  const base = {
    kind: "profile" as const,
    answer: null,
    at: p.updated_at,
    origin: "setup" as const,
    active: true,
  };
  const items: KnowledgeItem[] = [
    {
      ...base,
      id: "quiet_hours",
      text: `Quiet hours ${p.quiet_hours.start} to ${p.quiet_hours.end}`,
      forgettable: false,
    },
  ];
  if (p.work_days.length) {
    items.push({
      ...base,
      id: "usual_week",
      text: `Work ${daysPhrase(p.work_days)}, ${p.work_hours.start} to ${p.work_hours.end}`,
      forgettable: false,
    });
  }
  if (p.gym_days.length) {
    items.push({ ...base, id: "gym_days", text: `Training ${daysPhrase(p.gym_days)}`, forgettable: false });
  }
  for (const w of p.weak_spots) {
    items.push({
      ...base,
      id: `weak_spots:${w}`,
      text: `Weak spot: ${WEAK_SPOT_COPY[w]}`,
      forgettable: true,
    });
  }
  for (const t of p.fixed_titles) {
    items.push({ ...base, id: `fixed_titles:${t}`, text: `Never move "${t}"`, forgettable: true });
  }
  return items;
}

const instructionItem = (i: Instruction): KnowledgeItem => ({
  id: i.id,
  kind: "instruction",
  text: i.exceptions?.length ? `${i.text} (except ${i.exceptions.join(", ")})` : i.text,
  answer: null,
  at: i.created_at,
  origin: "you",
  active: i.active,
  forgettable: true,
});

const stamp = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));

const localDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(ms);

/** Everything Michael uses about the current user, in plain words. */
export async function knowledgeFor(now = Date.now()): Promise<Knowledge> {
  const [memories, checkIns, instructions, profile, rules, last, agents, queries] = await Promise.all([
    listMemories(MAX_MEMORIES),
    store.listCheckIns({ fromDay: localDay(now - CHECK_IN_DAYS * DAY_MS), toDay: localDay(now) }),
    store.listInstructions(),
    store.getProfile(),
    store.privacyRules(),
    store.lastEventAtBySource(),
    agentsStore.listAgents(),
    agentsStore.listQueries({ from: athensMidnight(new Date(now)), to: new Date(now).toISOString() }),
  ]);

  const answered = checkIns
    .filter((c) => c.answer !== null && c.answered_at)
    .sort((a, b) => Date.parse(b.answered_at as string) - Date.parse(a.answered_at as string))
    .slice(0, MAX_CHECK_INS);

  const told: KnowledgeItem[] = [
    ...memories.map(
      (m): KnowledgeItem => ({
        id: m.id,
        kind: "memory",
        text: m.text,
        answer: null,
        at: m.at,
        origin: m.from,
        active: true,
        forgettable: true,
      }),
    ),
    ...answered.map(
      (c): KnowledgeItem => ({
        id: c.id,
        kind: "check_in",
        text: c.question,
        answer: String(c.answer),
        at: c.answered_at,
        origin: "check_in",
        active: true,
        forgettable: true,
      }),
    ),
    ...[...instructions]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map(instructionItem),
    ...profileItems(profile),
  ];

  const privacy = toPrivacyState(rules);
  const enabled = new Map(privacy.sources.map((s) => [s.source, s.enabled]));
  const reads: KnowledgeSource[] = Source.options
    .filter((s) => !NOT_A_CONNECTION.has(s) && (enabled.get(s) || last[s]))
    .map((source) => {
      const [name, sends] = SOURCE_COPY[source] ?? [source, ""];
      return {
        source,
        name,
        sends,
        enabled: enabled.get(source) ?? false,
        collecting: decide(rules, source) === "collect",
        last_event_at: last[source] ?? null,
      };
    });

  return {
    told,
    reads,
    never_kept: [...NEVER_KEPT],
    off_the_record: privacy.off_the_record,
    asked_today: queries.length,
    agents_connected: agents.filter((a) => a.status === "approved").length,
  };
}

const KIND_HEADING: Record<KnowledgeItem["kind"], string> = {
  memory: "Things you told me to remember",
  check_in: "Your check in answers",
  instruction: "Your standing instructions",
  profile: "From your setup",
};

/** The same, as short plain text for the chat model and MCP clients. Ids so a client can act. */
export function knowledgeText(k: Knowledge): string {
  const lines: string[] = [];
  for (const kind of ["memory", "check_in", "instruction", "profile"] as const) {
    const items = k.told.filter((i) => i.kind === kind);
    if (!items.length) continue;
    lines.push(`${KIND_HEADING[kind]}:`);
    for (const i of items) {
      const answer = i.answer ? ` You said: "${i.answer}".` : "";
      const paused = i.active ? "" : " (paused)";
      const id = kind === "memory" ? ` {memory_id ${i.id}}` : "";
      lines.push(`- ${i.text}${paused}${answer}${id}`);
    }
  }
  if (!k.told.length) lines.push("You have not told me anything to keep yet.");
  lines.push(
    k.reads.length
      ? `What I read: ${k.reads
          .map(
            (r) =>
              `${r.name} (${r.collecting ? "on" : "off"}${r.last_event_at ? `, last data ${stamp(r.last_event_at)}` : ""})`,
          )
          .join("; ")}.`
      : "What I read: no connections yet.",
  );
  if (k.off_the_record) lines.push("Off the record: I am not collecting anything right now.");
  lines.push(`What I never keep: ${k.never_kept.join(" ")}`);
  lines.push(
    `Agents asked about you ${k.asked_today} ${k.asked_today === 1 ? "time" : "times"} today; ${k.agents_connected} connected.`,
  );
  lines.push("The user can see and forget each item under You, Privacy, What I know about you.");
  return lines.join("\n");
}
