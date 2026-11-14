import { createReadStream, type Dirent, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import {
  AI_SESSION_TITLE_MAX,
  aiPromptTitle,
  claudeCodePromptExternalId,
  type EventInput,
  isTypedPrompt,
  scrubSecrets,
} from "@michael/shared";
import type { Reader, ReaderContext, ReaderResult } from "../types";

// Claude Code keeps one transcript per session in ~/.claude/projects/<project>/<session>.jsonl,
// one JSON object per line, and one more file per subagent under <session>/subagents/. Sessions
// from the terminal, the VS Code extension and the desktop app all land there. The format is
// internal and undocumented, so everything here is best effort: a line that does not parse or a
// record type we do not know is skipped, never an error.
//
// PRIVACY: only the first characters of what the person typed (secrets masked) and numbers leave
// this file. Tool inputs, tool results, file contents and assistant text are never read into an
// event.

// CLAUDE_CONFIG_DIR is Claude Code's own setting for moving ~/.claude.
const DEFAULT_ROOT = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");

// A session file can stay open for days. A WORK STRETCH is a run of activity with no pause longer
// than this; each stretch becomes one `ai_session` event.
const GAP_MS = 30 * 60_000;

// Lines hold whole tool results and pasted files, so a few are hundreds of megabytes. Above
// BLOB_CHECK a line first loses its embedded base64 payloads; if it is still above MAX_LINE it
// is skipped.
const BLOB_CHECK = 1_000_000;
const BLOB_MIN = 10_000;
const MAX_LINE = 32_000_000;

// Cheap test that spares a JSON.parse for the many record types we do not use.
const WANTED = /"type"\s*:\s*"(?:user|assistant|ai-title|custom-title)"/;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Cuts long escape-free string bodies (base64 images and documents) out of a line so the rest can
 * be parsed. Walks from quote to quote with indexOf: a regular expression overflows the stack on
 * payloads this long. A gap that starts with JSON punctuation lies between two strings, not inside
 * one, and is kept.
 */
function dropBlobs(line: string): string {
  let out = "";
  let from = 0;
  let quote = line.indexOf('"');
  while (quote !== -1) {
    const next = line.indexOf('"', quote + 1);
    if (next === -1) break;
    if (next - quote > BLOB_MIN) {
      const first = line[quote + 1];
      const between = first === ":" || first === "," || first === "}" || first === "]";
      if (!between && !line.slice(quote + 1, next).includes("\\")) {
        out += line.slice(from, quote + 1);
        from = next;
      }
    }
    quote = next;
  }
  return from === 0 ? line : out + line.slice(from);
}

async function* records(file: string): AsyncGenerator<Json> {
  // Streamed line by line: files reach tens of megabytes and more.
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Number.POSITIVE_INFINITY });
  for await (const raw of lines) {
    const line = raw.length > BLOB_CHECK ? dropBlobs(raw) : raw;
    if (line.length > MAX_LINE || !WANTED.test(line)) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isObject(parsed)) yield parsed;
    } catch {
      // A half written or damaged line. Skip it.
    }
  }
}

// What the person typed, or null when this "user" record is not a prompt from a human. In a
// transcript the role "user" also carries tool results, hook and system reminders, background task
// reports, messages from other sessions, compaction summaries and slash command wrappers.
function humanPromptText(r: Json): string | null {
  if (r.isSidechain === true || r.isMeta === true) return null;
  if (r.isCompactSummary === true || r.isVisibleInTranscriptOnly === true) return null;
  if (r.toolUseResult !== undefined || r.sourceToolUseID !== undefined) return null;
  // Newer versions say where a turn came from: "human", "task-notification", "peer" and so on.
  const origin = isObject(r.origin) ? str(r.origin.kind) : str(r.origin);
  if (origin !== undefined ? origin !== "human" : r.promptSource === "system") return null;

  const content = isObject(r.message) ? r.message.content : undefined;
  let text: string;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    const blocks = content.filter(isObject);
    if (blocks.some((b) => b.type === "tool_result")) return null;
    // Images and files are ignored; a prompt with only those keeps an empty text.
    text = blocks.map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : "")).join("\n");
  } else {
    return null;
  }
  // Older records carry no origin, so the text decides: tool-written messages open with a tag.
  return isTypedPrompt(text) ? text : null;
}

type Prompt = { t: number; id: string; title: string; sessionTitle: string; cwd?: string };
// One timestamped record. `main` is false for subagent records.
type Mark = { t: number; main: boolean; kind: "prompt" | "assistant" | "other"; cwd?: string };
// One model answer. A transcript repeats the same usage on every content block of an answer, so
// answers are keyed by message id and counted once.
type Answer = {
  t: number;
  main: boolean;
  model?: string;
  input: number;
  cached: number;
  output: number;
};

type Session = {
  id: string;
  marks: Mark[];
  prompts: Prompt[];
  answers: Map<string, Answer>;
  aiTitle?: string;
  customTitle?: string;
};

async function scan(file: string, main: boolean, s: Session) {
  for await (const r of records(file)) {
    if (r.type === "ai-title") s.aiTitle = str(r.aiTitle) ?? s.aiTitle;
    if (r.type === "custom-title") s.customTitle = str(r.customTitle) ?? s.customTitle;
    if (r.type !== "user" && r.type !== "assistant") continue;

    const t = Date.parse(str(r.timestamp) ?? "");
    if (Number.isNaN(t)) continue;
    // Older versions kept subagent turns inside the session file, flagged as a sidechain.
    const onMain = main && r.isSidechain !== true;
    const cwd = str(r.cwd);

    if (r.type === "assistant") {
      s.marks.push({ t, main: onMain, kind: "assistant", cwd });
      const message = isObject(r.message) ? r.message : {};
      const usage = isObject(message.usage) ? message.usage : {};
      const model = str(message.model);
      const cached = num(usage.cache_read_input_tokens);
      s.answers.set(str(message.id) ?? str(r.uuid) ?? `${file}:${t}`, {
        t,
        main: onMain,
        // "<synthetic>" marks answers Claude Code wrote itself, such as an API error notice.
        model: model?.startsWith("<") ? undefined : model,
        input: num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + cached,
        cached,
        output: num(usage.output_tokens),
      });
      continue;
    }

    const text = onMain ? humanPromptText(r) : null;
    if (text === null) {
      s.marks.push({ t, main: onMain, kind: "other", cwd });
      continue;
    }
    s.marks.push({ t, main: true, kind: "prompt", cwd });
    s.prompts.push({
      t,
      // The hook payload names a prompt by the same id (`prompt_id`), which is what lets the live
      // event and this backfilled one share an external_id.
      id: str(r.promptId) ?? str(r.uuid) ?? String(t),
      title: aiPromptTitle(text),
      sessionTitle: aiPromptTitle(text, AI_SESSION_TITLE_MAX),
      cwd,
    });
  }
}

const project = (cwd: string | undefined) => (cwd ? basename(cwd) : "unknown");

function mostUsed(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  let best: string | undefined;
  for (const v of values) {
    if (!v) continue;
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (best === undefined || n > (counts.get(best) ?? 0)) best = v;
  }
  return best;
}

/** Turns one scanned session into events. Returns whether its last stretch is still open. */
function toEvents(s: Session, floor: number, now: number, events: EventInput[]) {
  const marks = s.marks.sort((a, b) => a.t - b.t);
  // A new stretch starts when two consecutive user or assistant records (subagents included, so a
  // long subagent run does not look like a pause) are more than 30 minutes apart.
  const stretches: Mark[][] = [];
  for (const mark of marks) {
    const current = stretches.at(-1);
    const last = current?.at(-1);
    if (current && last && mark.t - last.t <= GAP_MS) current.push(mark);
    else stretches.push([mark]);
  }

  const answers = [...s.answers.values()];
  const base = { source: "claude_code" as const, tool: "claude_code" };
  const seen = new Set<string>();
  let open = false;
  let stretchCount = 0;
  let promptCount = 0;

  for (const stretch of stretches) {
    const start = stretch[0]?.t ?? 0;
    const end = stretch.at(-1)?.t ?? start;
    if (end < floor) continue;
    const inside = <T extends { t: number }>(items: T[]) => items.filter((i) => i.t >= start && i.t <= end);

    // Prompts are instants and never change, so they go out even while the stretch is still open.
    const prompts = inside(s.prompts);
    for (const prompt of prompts) {
      let id = claudeCodePromptExternalId(s.id, prompt.id);
      if (seen.has(id)) id = `${id}:${prompt.t}`;
      seen.add(id);
      promptCount++;
      events.push({
        source: base.source,
        type: "ai_prompt",
        start_at: new Date(prompt.t).toISOString(),
        end_at: null,
        title: prompt.title,
        data: { tool: base.tool, session_id: s.id, project: project(prompt.cwd) },
        external_id: id,
      });
    }

    // Ingest dedupes on external_id and does not update. So a stretch is emitted only once it is
    // CLOSED (its last record is more than 30 minutes old): from then on a new record can only
    // start a new stretch, which makes these numbers final. An open stretch waits for a later run.
    if (now - end <= GAP_MS) {
      open = true;
      continue;
    }

    const mine = inside(answers);
    // Nothing typed and nothing answered (for example a lone command output): not a work stretch.
    if (prompts.length === 0 && mine.length === 0) continue;

    // waiting_seconds: "the tool was done and waiting for the person". For every human prompt in
    // the stretch whose previous record on the main thread is an assistant record (the end of an
    // assistant turn), add the time from that record to the prompt, if it is under 30 minutes.
    // Not counted: a prompt that follows a tool result or an interrupt (the assistant was still
    // working), the first prompt of a stretch, and longer gaps (the person had left).
    let waitingMs = 0;
    let previous: Mark | undefined;
    for (const mark of stretch) {
      if (!mark.main) continue;
      if (mark.kind === "prompt" && previous?.kind === "assistant" && mark.t - previous.t < GAP_MS) {
        waitingMs += mark.t - previous.t;
      }
      previous = mark;
    }

    const mainAnswers = mine.filter((a) => a.main);
    const sum = (pick: (a: Answer) => number) => mine.reduce((total, a) => total + pick(a), 0);
    const mainMarks = stretch.filter((m) => m.main);
    const title = s.customTitle ?? s.aiTitle ?? prompts[0]?.sessionTitle ?? "Claude Code session";

    stretchCount++;
    events.push({
      source: base.source,
      type: "ai_session",
      start_at: new Date(start).toISOString(),
      end_at: new Date(end).toISOString(),
      title: scrubSecrets(title.replace(/\s+/g, " ").trim()).slice(0, 120) || "Claude Code session",
      data: {
        tool: base.tool,
        session_id: s.id,
        // A session can move between folders; a stretch takes the one it spent most records in.
        project: project(mostUsed((mainMarks.length ? mainMarks : stretch).map((m) => m.cwd))),
        model: mostUsed((mainAnswers.length ? mainAnswers : mine).map((a) => a.model)),
        // Prompts typed by the person. Tool results and system records do not count.
        turns: prompts.length,
        waiting_seconds: Math.round(waitingMs / 1000),
        // Everything the model read, subagents included: fresh input plus cache writes plus cache
        // reads. `cached_input_tokens` is the cache read part, which is most of it.
        input_tokens: sum((a) => a.input),
        cached_input_tokens: sum((a) => a.cached),
        output_tokens: sum((a) => a.output),
      },
      external_id: `cc:${s.id}:${new Date(start).toISOString()}`,
    });
  }
  return { open, stretchCount, promptCount };
}

function list(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function mtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

// Subagent transcripts sit in <session>/subagents/, some of them in deeper folders.
function subagentFiles(dir: string): string[] {
  return list(dir).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return subagentFiles(path);
    return entry.name.endsWith(".jsonl") ? [path] : [];
  });
}

type Options = {
  /** Folder that holds one folder per project. Defaults to ~/.claude/projects. */
  root?: string;
  /** Clock, so a check can decide which stretches count as closed. */
  now?: () => number;
};

export function createClaudeCodeReader(options: Options = {}): Reader {
  const root = options.root ?? DEFAULT_ROOT;
  return {
    name: "claude-code",
    source: "claude_code",
    describe: "Claude Code sessions and prompts from its local transcripts (no special permission)",
    read: (ctx) => read(root, options.now?.() ?? Date.now(), ctx),
  };
}

async function read(root: string, now: number, ctx: ReaderContext): Promise<ReaderResult> {
  // Nothing older than the backfill window is emitted, on the first run or later.
  const floor = now - ctx.backfillDays * 86_400_000;
  // The cursor is a file modification time: only sessions touched after it are read again.
  const since = ctx.cursor ? Number(ctx.cursor) : 0;

  const events: EventInput[] = [];
  let newest = since;
  // A session with an open stretch must be read again even if nobody touches its file, so the
  // cursor is held just before the oldest such file until that stretch closes.
  let holdBack = Number.POSITIVE_INFINITY;
  const totals = { sessions: 0, unchanged: 0, stretches: 0, prompts: 0, open: 0 };

  for (const folder of list(root)) {
    if (!folder.isDirectory()) continue;
    const dir = join(root, folder.name);
    for (const entry of list(dir)) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const id = entry.name.slice(0, -".jsonl".length);
      const file = join(dir, entry.name);
      const subagents = subagentFiles(join(dir, id, "subagents"));
      // Taken before reading: a file that grows while we read it is picked up again next run.
      const modified = Math.max(mtime(file), ...subagents.map(mtime));
      if (modified <= since || modified < floor) {
        totals.unchanged++;
        continue;
      }

      const session: Session = { id, marks: [], prompts: [], answers: new Map() };
      try {
        await scan(file, true, session);
        // Subagent work counts towards its parent session; it is never a session of its own.
        for (const sub of subagents) await scan(sub, false, session);
      } catch (error) {
        // Keep the cursor before this file so the next run tries it again.
        ctx.log(`one transcript could not be read: ${(error as Error).message}`);
        holdBack = Math.min(holdBack, modified - 1);
        continue;
      }
      const result = toEvents(session, floor, now, events);
      totals.sessions++;
      totals.stretches += result.stretchCount;
      totals.prompts += result.promptCount;
      if (result.open) {
        totals.open++;
        holdBack = Math.min(holdBack, modified - 1);
      }
      newest = Math.max(newest, modified);
    }
  }

  events.sort((a, b) => a.start_at.localeCompare(b.start_at));
  ctx.log(
    `${totals.sessions} sessions read (${totals.unchanged} unchanged), ${totals.stretches} work stretches, ` +
      `${totals.prompts} prompts, ${totals.open} still open`,
  );
  const cursor = Math.min(newest, holdBack);
  return { events, cursor: cursor > 0 ? String(cursor) : ctx.cursor };
}

export const claudeCode = createClaudeCodeReader();
