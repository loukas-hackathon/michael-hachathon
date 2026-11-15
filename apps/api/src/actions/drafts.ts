import type { Draft, DraftChannel, DraftGenerateResult, Event } from "@michael/shared";
import { z } from "zod";
import { ModelNotConfiguredError, modelClient } from "../analysis/model";
import { HttpError } from "../http";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { type NewDraft, type Store, store } from "../store";

// Follow up drafts (#40). After a conversation (Omi: summary and the user's own commitments) or a
// calendar meeting with other people that has ended, Michael drafts a short message the user can
// copy and send themselves. Rules (Build Hub): Michael never sends anything in the user's name, so
// nothing here talks to any mail or chat service; only summaries go to the model, never a
// transcript (Omi transcripts are dropped at ingest anyway, src/ingest/omi.ts); one draft per event.

const HOUR = 3600_000;
/** Without an event id, drafts cover what ended in this window. */
export const DEFAULT_WINDOW_MS = 24 * HOUR;
export const DEFAULT_LIMIT = 3;
// A lecture or a kickoff with 40 people needs no follow up from the user.
const MAX_ATTENDEES = 10;
const MAX_BODY = 1200;

const zone = () => new Zone(DEFAULT_TIMEZONE);
const endOf = (e: Event) => Date.parse(e.end_at ?? e.start_at);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const commitmentsOf = (e: Event) =>
  Array.isArray(e.data.action_items)
    ? e.data.action_items.flatMap((x) => (typeof x === "string" && x.trim() ? [x.trim()] : []))
    : [];
const attendeesOf = (e: Event) => Number(e.data.attendees ?? 0) || 0;
const isMeetingWithOthers = (e: Event) =>
  e.type === "calendar_event" &&
  (e.data.with_others === true || attendeesOf(e) >= 2) &&
  attendeesOf(e) <= MAX_ATTENDEES &&
  e.data.all_day !== true &&
  e.data.status !== "cancelled";
const isConversation = (e: Event) =>
  e.type === "conversation" && (str(e.data.summary) !== null || commitmentsOf(e).length > 0);

/** Whether Michael can draft a follow up for this event at `now` (it must have ended). */
export function canDraft(e: Event, now: number): boolean {
  return endOf(e) <= now && (isConversation(e) || isMeetingWithOthers(e));
}

/**
 * The events worth a follow up, newest first. A meeting that a recorded conversation overlaps is
 * left out: the conversation has the summary, so its draft is the better one.
 */
export function candidates(events: Event[], now: number): Event[] {
  const ok = events.filter((e) => canDraft(e, now));
  const talks = ok.filter(isConversation);
  return ok
    .filter(
      (e) =>
        isConversation(e) ||
        !talks.some((t) => Date.parse(t.start_at) < endOf(e) && endOf(t) > Date.parse(e.start_at)),
    )
    .sort((a, b) => endOf(b) - endOf(a));
}

// ---------- the words ----------

export interface DraftText {
  channel: DraftChannel;
  subject: string | null;
  body: string;
}

const CHATTY = /\b(sync|stand ?up|check ?in|planning|catch ?up|1:1|team)\b/i;
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]?.toLowerCase() + s.slice(1) : s);
const stripStop = (s: string) => s.replace(/[.!?\s]+$/, "");
// Omi writes the user's commitments about the others ("send them the pricing"); the draft speaks to them.
const toYou = (s: string) =>
  s
    .replace(/\btheir\b/gi, "your")
    .replace(/\bthem\b/gi, "you")
    .replace(/\bthey\b/gi, "you");
const joinAnd = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** "today", "yesterday" or "on Thursday", by the user's local day. */
function whenWord(iso: string, now: number): string {
  const z = zone();
  const day = z.dayOf(Date.parse(iso));
  if (day === z.dayOf(now)) return "today";
  if (z.nextDay(day) === z.dayOf(now)) return "yesterday";
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: z.name, weekday: "long" }).format(
    Date.parse(iso),
  );
  return `on ${weekday}`;
}

/**
 * The draft without a model: plain and short. A note to the user's own team quotes the summary
 * (what "we" agreed). An email to people outside it never does: the summary is written about them
 * ("the pilot team finds setup too long") and a template cannot turn that into "you", so the email
 * thanks them and says what the user does next, every line speaking to its reader.
 */
export function templateDraft(e: Event, now: number): DraftText {
  const base = e.title.split(":")[0]?.trim() || e.title;
  const summary = str(e.data.summary);
  const items = commitmentsOf(e).map((c) => toYou(stripStop(c)));
  const when = whenWord(e.start_at, now);

  if (CHATTY.test(e.title)) {
    const recap = summary ? `Quick recap from my side: ${lowerFirst(summary)}` : null;
    const next = items.length
      ? `Next from me: I will ${joinAnd(items.map(lowerFirst))}.`
      : "Shout if I missed anything.";
    return {
      channel: "chat",
      subject: null,
      body: [`Thanks for the ${base.toLowerCase()} ${when}.`, recap, next].filter(Boolean).join(" "),
    };
  }
  const next = items.length
    ? `Next from me:\n${items.map((x, i) => `${i + 1}. ${x}`).join("\n")}`
    : "Tell me if anything is still open on your side.";
  return {
    channel: "email",
    subject: `Following up: ${base}`,
    // "Hello," stands without a name; the notes rarely carry one.
    body: ["Hello,", `Thanks for your time ${when}.`, next, "Best,"].join("\n\n"),
  };
}

export const DRAFT_INSTRUCTIONS = `You write one short follow up message that the user will copy and send themselves after a conversation or a meeting. You never send anything; the user does.

Write as the user, in the first person, to the other people who were there.
- British spelling, 24-hour time. No emoji. Do not use dashes of any kind as punctuation.
- Use only the facts in the notes. Never invent names, dates, prices or promises. If no names are given, open with "Hello," (or "Hello all," for a group).
- Speak to the readers as "you". The notes describe them in the third person ("the pilot team finds setup too long"); never repeat that to them: write "you find setup too long", or leave the line out.
- Thank them in one line, recap what was agreed in one or two lines, then list the user's own commitments with any deadline the notes give.
- Body under 90 words. No placeholders in brackets. End with a short sign off and no name.
- channel: "email" for people outside the user's team (customers, investors, mentors); "chat" for a quick note to their own team. subject: a short email subject, or null for chat.

Answer with the JSON only.`;

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["channel", "subject", "body"],
  properties: {
    channel: { type: "string", enum: ["email", "chat"] },
    subject: { anyOf: [{ type: "string" }, { type: "null" }], description: "Email subject, null for chat" },
    body: { type: "string", description: "The message, under 90 words" },
  },
} as const;

const ModelDraft = z.object({
  channel: z.enum(["email", "chat"]),
  subject: z.string().trim().max(200).nullable(),
  body: z.string().trim().min(1),
});

/** What the model reads: the event's title, time, size, summary and the user's commitments. Nothing else. */
export function draftBrief(e: Event, now: number): string {
  const z = zone();
  const start = Date.parse(e.start_at);
  const lines = [
    `What: ${e.type === "conversation" ? "a conversation the user recorded in meetings mode" : "a calendar meeting"}`,
    `Title: ${e.title}`,
    `When: ${whenWord(e.start_at, now)}, ${z.clock(start)}${e.end_at ? ` to ${z.clock(Date.parse(e.end_at))}` : ""}`,
  ];
  if (attendeesOf(e)) lines.push(`People invited, the user included: ${attendeesOf(e)}`);
  const summary = str(e.data.summary);
  if (summary) lines.push(`Summary: ${summary}`);
  const items = commitmentsOf(e);
  if (items.length) lines.push(`The user's own commitments:\n${items.map((x) => `* ${x}`).join("\n")}`);
  if (!summary && !items.length)
    lines.push("No notes were recorded: keep it to thanks and one line on next steps.");
  return lines.join("\n");
}

// Copy rules the model sometimes forgets: no dashes as punctuation, no emoji.
const tidy = (s: string) =>
  s
    .replace(/\s+[–—-]\s+/g, ", ")
    .replace(/[–—]/g, ", ")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .trim();

/** Claude's draft, or null when there is no key or the model fails (the caller uses the template). */
export async function modelDraft(e: Event, now: number): Promise<DraftText | null> {
  try {
    const reply = await modelClient().complete({
      system: DRAFT_INSTRUCTIONS,
      user: draftBrief(e, now),
      schema: DRAFT_SCHEMA as unknown as Record<string, unknown>,
    });
    const parsed = ModelDraft.safeParse(JSON.parse(reply.text));
    if (!parsed.success) {
      console.error("drafts: the model answered off schema");
      return null;
    }
    const d = parsed.data;
    const subject = d.channel === "email" ? tidy(d.subject ?? "") || `Following up: ${e.title}` : null;
    return { channel: d.channel, subject, body: tidy(d.body).slice(0, MAX_BODY) };
  } catch (err) {
    if (!(err instanceof ModelNotConfiguredError)) console.error("drafts: model failed", err);
    return null;
  }
}

/** The draft for one event, from Claude when it can, otherwise from the template. Not stored. */
export async function writeDraft(e: Event, now: number, useModel = true): Promise<NewDraft> {
  const fromModel = useModel ? await modelDraft(e, now) : null;
  const text = fromModel ?? templateDraft(e, now);
  return {
    event_id: e.id,
    recommendation_id: null,
    title: e.title,
    event_at: e.start_at,
    ...text,
    written_by: fromModel ? "model" : "template",
  };
}

export interface GenerateOptions {
  eventId?: string;
  now?: number;
  /** false: template only (the demo week, so seeding never waits on a model). */
  useModel?: boolean;
  windowMs?: number;
  limit?: number;
}

/**
 * Drafts follow ups for the current user and stores them. With an event id, that event only (404
 * when it is not on the timeline, 409 when there is nothing to follow up); otherwise every
 * conversation and meeting with others that ended in the window and has no draft yet.
 */
export async function generateDrafts(opts: GenerateOptions = {}): Promise<DraftGenerateResult> {
  const now = opts.now ?? Date.now();
  let targets: Event[];
  if (opts.eventId) {
    const e = await store.getEvent(opts.eventId);
    if (!e) throw new HttpError("not_found", "That event is not on your timeline");
    if (!canDraft(e, now))
      throw new HttpError(
        "conflict",
        endOf(e) > now
          ? "That has not finished yet. I draft follow ups once it ends."
          : "Nothing to follow up there: it is not a conversation or a meeting with other people.",
      );
    targets = [e];
  } else {
    const events = await store.listEvents({
      from: new Date(now - (opts.windowMs ?? DEFAULT_WINDOW_MS)).toISOString(),
      to: new Date(now).toISOString(),
      type: ["conversation", "calendar_event"],
    });
    targets = candidates(events, now);
  }

  const have = new Set((await store.listDrafts()).flatMap((d) => (d.event_id ? [d.event_id] : [])));
  const fresh = targets.filter((e) => !have.has(e.id)).slice(0, opts.limit ?? DEFAULT_LIMIT);
  const drafts: Draft[] = [];
  for (const e of fresh) {
    const saved = await store.createDraft(await writeDraft(e, now, opts.useModel ?? true));
    if (saved) drafts.push(saved);
  }
  return { drafts, skipped: targets.length - fresh.length };
}

const DEMO_DRAFTS = 2;

/**
 * The demo week's follow ups: template drafts for its two most recent conversations or meetings
 * with others, so Today shows them without a model call. Idempotent (one draft per event), and a
 * draft the presenter dismissed stays dismissed. Returns how many were added.
 *
 * A waiting template draft whose event is gone is removed first: a reseed replaces a conversation
 * whose words changed (demo/week.ts puts them in its id) and drops days that left the window, and
 * the old words must not stay on Today. Drafts that were sent or dismissed, and drafts Claude or
 * the analysis wrote, are never touched.
 */
export async function seedDemoDrafts(db: Store, now: number, days: number): Promise<number> {
  const events = await db.listEvents({
    from: new Date(now - days * 24 * HOUR).toISOString(),
    to: new Date(now).toISOString(),
    type: ["conversation", "calendar_event"],
  });
  const listed = new Set(events.map((e) => e.id));
  const orphans: string[] = [];
  for (const d of await db.listDrafts({ status: "proposed" })) {
    if (d.written_by !== "template" || !d.event_id || listed.has(d.event_id)) continue;
    if (!(await db.getEvent(d.event_id))) orphans.push(d.id);
  }
  if (orphans.length) await db.deleteDrafts(orphans);

  let added = 0;
  // Conversations first: their summary makes the better draft on stage.
  const picks = candidates(events, now).sort(
    (a, b) => Number(b.type === "conversation") - Number(a.type === "conversation"),
  );
  for (const e of picks.slice(0, DEMO_DRAFTS)) {
    if (await db.createDraft(await writeDraft(e, now, false))) added++;
  }
  return added;
}

/** Stores the draft a carried out draft_follow_up recommendation carries. */
export async function draftFromRecommendation(rec: {
  id: string;
  title: string;
  payload: Record<string, unknown>;
}): Promise<Draft> {
  const body = str(rec.payload.text);
  if (!body) throw new HttpError("conflict", "That suggestion has no draft text");
  const saved = await store.createDraft({
    event_id: null,
    recommendation_id: rec.id,
    title: rec.title,
    event_at: null,
    channel: "email",
    subject: null,
    body: body.slice(0, MAX_BODY),
    written_by: "analysis",
  });
  if (!saved) throw new HttpError("conflict", "That draft is already saved");
  return saved;
}

/** "Copy it and send it yourself" text for chat and MCP replies. */
export function draftText(d: Draft): string {
  const head = `${d.channel === "email" ? "Email" : "Chat message"} for "${d.title}" (id ${d.id}, ${d.status})`;
  return [head, d.subject ? `Subject: ${d.subject}` : null, d.body].filter(Boolean).join("\n");
}
