import {
  CreateFocusBlockPayload,
  type Event,
  MoveCalendarBlockPayload,
  type Recommendation,
  type RecommendationAction,
} from "@michael/shared";
import { z } from "zod";
import { HttpError, parse } from "../http";
import { toTimelineEvent } from "../integrations/calendar-sync";
import {
  createdByMichael,
  deleteCalendarEvent,
  type GoogleEvent,
  getCalendarEvent,
  insertCalendarEvent,
  patchCalendarEvent,
  withOthers,
} from "../integrations/google";
import { store } from "../store";

// Michael acts on the user's own time only. Rules (Build Hub, docs/api.md):
// - never an event with other people (refused with 409, checked again against Google itself);
// - never deletes the user's events: undo deletes only a block Michael created, and moves a moved
//   block back;
// - nothing in the past, and undo only until the affected block starts.
// With Google Calendar connected the change happens in the calendar and the timeline mirrors it;
// without it, it happens on the timeline only (Michael's own blocks, source "agent").

const Times = z.object({ start_at: z.string(), end_at: z.string().nullable(), title: z.string() });

// Saved on the recommendation (jsonb `execution`) so undo knows exactly what to put back.
const Execution = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_focus_block"),
    timeline_event_id: z.string().nullable(),
    google_event_id: z.string().nullable(),
    undo_until: z.string(),
  }),
  z.object({
    kind: z.literal("move_calendar_block"),
    timeline_event_id: z.string(),
    google_event_id: z.string().nullable(),
    original: Times,
    undo_until: z.string(),
  }),
]);
type Execution = z.infer<typeof Execution>;

const conflict = (message: string) => new HttpError("conflict", message);
const earliest = (...isos: (string | null | undefined)[]) =>
  new Date(Math.min(...isos.filter((x): x is string => Boolean(x)).map((x) => Date.parse(x)))).toISOString();

async function googleConnected(): Promise<boolean> {
  return (await store.getIntegration("google_calendar"))?.status === "connected";
}

/** Writes Google's view of an event back into the timeline mirror; returns the timeline event. */
async function mirror(g: GoogleEvent, fallbackZone = "Europe/Athens"): Promise<Event | null> {
  const input = toTimelineEvent(g, fallbackZone);
  if (!input) return null;
  const r = await store.upsertEvents([input]);
  const hit = r.inserted[0] ?? r.updated[0];
  if (hit) return hit;
  const events = await store.listEvents({
    from: input.start_at,
    to: input.end_at ?? input.start_at,
    source: ["google_calendar"],
  });
  return events.find((e) => e.external_id === g.id) ?? null;
}

const isOthers = (e: Event) => e.data.with_others === true || Number(e.data.attendees ?? 0) >= 2;

async function createFocusBlock(rec: Recommendation, action: RecommendationAction): Promise<Execution> {
  const p = parse(CreateFocusBlockPayload, action.payload);
  if (Date.parse(p.start_at) <= Date.now()) throw conflict("That time has already started");
  const title = p.title ?? "Focus block";
  const undoUntil = earliest(action.undo_until, p.start_at);

  if (await googleConnected()) {
    const created = await insertCalendarEvent({
      summary: title,
      description: "Planned by Michael. Undo in Michael until it starts.",
      start: { dateTime: p.start_at },
      end: { dateTime: p.end_at },
      transparency: "opaque",
      reminders: { useDefault: true },
      extendedProperties: { private: { michael: "1", recommendation_id: rec.id } },
    });
    const local = await mirror(created);
    return {
      kind: "create_focus_block",
      timeline_event_id: local?.id ?? null,
      google_event_id: created.id,
      undo_until: undoUntil,
    };
  }

  const { inserted } = await store.insertEvents([
    {
      source: "agent",
      type: "calendar_event",
      start_at: p.start_at,
      end_at: p.end_at,
      title,
      data: { michael: true, with_others: false, attendees: 0, recommendation_id: rec.id },
      external_id: `michael:${rec.id}`,
    },
  ]);
  const local = inserted[0];
  if (!local) throw conflict("I could not add the block to your timeline");
  return {
    kind: "create_focus_block",
    timeline_event_id: local.id,
    google_event_id: null,
    undo_until: undoUntil,
  };
}

async function moveCalendarBlock(action: RecommendationAction): Promise<Execution> {
  const p = parse(MoveCalendarBlockPayload, action.payload);
  const event = await store.getEvent(p.event_id);
  if (!event) throw new HttpError("not_found", "The block to move is no longer on the timeline");
  if (event.type !== "calendar_event") throw conflict("Only calendar blocks can be moved");
  if (isOthers(event)) throw conflict("That event has other people in it. I only advise on those.");
  if (Date.parse(event.start_at) <= Date.now()) throw conflict("That block has already started");

  const length =
    (event.end_at ? Date.parse(event.end_at) : Date.parse(event.start_at)) - Date.parse(event.start_at);
  const start = p.start_at ?? event.start_at;
  const end =
    p.end_at ?? (p.start_at ? new Date(Date.parse(p.start_at) + length).toISOString() : event.end_at);
  if (Date.parse(start) <= Date.now()) throw conflict("The new time has already started");
  if (end && Date.parse(end) <= Date.parse(start)) throw conflict("The block would end before it starts");
  const original = { start_at: event.start_at, end_at: event.end_at, title: event.title };
  const undoUntil = earliest(action.undo_until, event.start_at, start);

  if (event.source === "google_calendar") {
    if (!event.external_id) throw conflict("That block has no calendar id");
    const g = await getCalendarEvent(event.external_id);
    // Check Google itself: someone may have been invited since the last sync.
    if (withOthers(g)) throw conflict("That event has other people in it. I only advise on those.");
    if (g.start?.date && !g.start.dateTime) throw conflict("I do not move all day events");
    const patched = await patchCalendarEvent(g.id, {
      start: { dateTime: start, timeZone: g.start?.timeZone },
      end: { dateTime: end ?? start, timeZone: g.end?.timeZone },
      ...(p.new_title ? { summary: p.new_title } : {}),
    });
    const local = await mirror(patched);
    return {
      kind: "move_calendar_block",
      timeline_event_id: local?.id ?? event.id,
      google_event_id: g.id,
      original: { ...original, title: g.summary ?? original.title },
      undo_until: undoUntil,
    };
  }

  await store.updateEvent(event.id, {
    start_at: start,
    end_at: end,
    ...(p.new_title ? { title: p.new_title } : {}),
  });
  return {
    kind: "move_calendar_block",
    timeline_event_id: event.id,
    google_event_id: null,
    original,
    undo_until: undoUntil,
  };
}

export async function executeRecommendation(id: string): Promise<Recommendation> {
  const rec = await store.getRecommendation(id);
  if (!rec) throw new HttpError("not_found", "Recommendation not found");
  const action = rec.action;
  if (!action) throw conflict("This recommendation has nothing to carry out");
  if (rec.status === "done") throw conflict("Already done");
  if (rec.status === "dismissed") throw conflict("This recommendation was dismissed");
  if (action.involves_others) throw conflict("This involves other people. I only advise on it.");

  let execution: Execution;
  if (action.kind === "create_focus_block") execution = await createFocusBlock(rec, action);
  else if (action.kind === "move_calendar_block") execution = await moveCalendarBlock(action);
  else throw new HttpError("not_implemented", `${action.kind} cannot be carried out yet`);

  const saved = await store.recordRecommendationAction(id, {
    status: "done",
    executed_at: new Date().toISOString(),
    undone_at: null,
    execution,
  });
  if (!saved) throw new HttpError("not_found", "Recommendation not found");
  return saved;
}

export async function undoRecommendation(id: string): Promise<Recommendation> {
  const rec = await store.getRecommendation(id);
  if (!rec) throw new HttpError("not_found", "Recommendation not found");
  if (rec.status !== "done") throw conflict("Only a done recommendation can be undone");
  const parsed = Execution.safeParse(await store.getRecommendationExecution(id));
  if (!parsed.success) throw conflict("I have no record of what I changed, so I cannot undo it");
  const ex = parsed.data;
  if (Date.now() >= Date.parse(ex.undo_until)) throw conflict("Too late to undo: the block has started");

  if (ex.kind === "create_focus_block") {
    if (ex.google_event_id) {
      try {
        const g = await getCalendarEvent(ex.google_event_id);
        // Only ever delete a block Michael created himself.
        if (!createdByMichael(g)) throw conflict("That block is not mine to remove");
        if (withOthers(g)) throw conflict("Someone else is on that block now. Remove it in your calendar.");
        await deleteCalendarEvent(g.id);
      } catch (err) {
        // Already gone from the calendar: nothing to undo there.
        if (!(err instanceof HttpError && err.code === "not_found")) throw err;
      }
    }
    if (ex.timeline_event_id) await store.deleteEvents([ex.timeline_event_id]);
  } else {
    const o = ex.original;
    if (ex.google_event_id) {
      const g = await getCalendarEvent(ex.google_event_id);
      if (withOthers(g)) throw conflict("Someone else is on that block now. Move it in your calendar.");
      const restored = await patchCalendarEvent(g.id, {
        start: { dateTime: o.start_at, timeZone: g.start?.timeZone },
        end: { dateTime: o.end_at ?? o.start_at, timeZone: g.end?.timeZone },
        summary: o.title,
      });
      await mirror(restored);
    } else {
      await store.updateEvent(ex.timeline_event_id, {
        start_at: o.start_at,
        end_at: o.end_at,
        title: o.title,
      });
    }
  }

  const saved = await store.recordRecommendationAction(id, {
    status: "undone",
    undone_at: new Date().toISOString(),
  });
  if (!saved) throw new HttpError("not_found", "Recommendation not found");
  return saved;
}
