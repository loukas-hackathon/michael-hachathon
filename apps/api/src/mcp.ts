import {
  type Event,
  EventInput,
  EventType,
  type Goal,
  GoalCategory,
  GoalCreate,
  GoalUpdate,
  type Moment,
  MomentKind,
  type Recommendation,
  RecommendationStatus,
  type Score,
  Source,
  TravelPlanInput,
} from "@michael/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { bookFocusBlock, executeRecommendation, undoDeadline, undoRecommendation } from "./actions/calendar";
import { currentAgent } from "./context";
import { HttpError, parse } from "./http";
import {
  dayLabel,
  dur,
  failure,
  LocalDayInput,
  pct,
  reply,
  span,
  TimeInput,
  toInstant,
  when,
  zone,
} from "./mcp-format";
import { guardTools } from "./mcp-guard";
import { momentFor } from "./routes/moments";
import { patternReportFor } from "./routes/patterns";
import { travelPlanFor } from "./routes/places";
import { scoreFor } from "./routes/score";
import { store } from "./store";

// The claude.ai connector's tool set. Every tool answers with short text in the user's local time
// (24 hour, Europe/Athens) plus structured content. Writes follow Michael's autonomy rules: only
// the user's own time, never an event with other people, never deletes the user's events, never
// sends anything in the user's name, and every calendar change can be undone until it starts.

const TZ_NOTE =
  "Times: write YYYY-MM-DDTHH:MM for Europe/Athens local time, or ISO 8601 with an offset. Replies use 24 hour local time.";

const Id = z.uuid();
const DEVICE_TYPES: EventType[] = ["app_usage", "web_visit", "screen"];
const MAX_LINES = 120;
const MAX_EVENTS = 500;

/** Runs a tool body; an HttpError becomes a tool error the model can read and act on. */
const safe =
  <A extends unknown[]>(fn: (...args: A) => Promise<ReturnType<typeof reply>>) =>
  async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) {
        const issues = Array.isArray(err.details)
          ? (err.details as { path?: unknown[]; message?: string }[])
              .map((i) => `${(i.path ?? []).join(".") || "input"}: ${i.message}`)
              .join("; ")
          : "";
        return failure(issues ? `${err.message}: ${issues}` : err.message);
      }
      throw err;
    }
  };

const isWithOthers = (e: Event) => e.data.with_others === true || Number(e.data.attendees ?? 0) >= 2;

function eventLine(e: Event): string {
  const tags: string[] = [e.source];
  if (e.type === "calendar_event") tags.push(isWithOthers(e) ? "with others" : "own time");
  if (e.data.michael === true) tags.push("booked by Michael");
  return `- ${span(e.start_at, e.end_at)}  ${e.type}  "${e.title}" (${tags.join(", ")}) id ${e.id}`;
}

function goalLine(g: Goal): string {
  const budget =
    g.weekly_budget_minutes == null ? "no weekly budget" : `${dur(g.weekly_budget_minutes)} a week`;
  return `- ${g.category}: "${g.title}", ${budget}${g.active ? "" : ", paused"} (id ${g.id})`;
}

function recommendationLine(r: Recommendation, goals: Map<string, Goal>): string {
  const goal = r.goal_id ? goals.get(r.goal_id)?.title : null;
  const parts = [`- [${r.status}] "${r.title}" (id ${r.id})`];
  if (goal) parts.push(`for "${goal}"`);
  if (r.rationale) parts.push(`Why: ${r.rationale}`);
  const a = r.action;
  if (!a) parts.push("Advice only.");
  else if (a.involves_others) parts.push(`Advice only (${a.kind} involves other people).`);
  else {
    const p = a.payload as { start_at?: string; end_at?: string };
    const at = typeof p.start_at === "string" ? ` ${span(p.start_at, p.end_at)}` : "";
    parts.push(`Can carry out: ${a.kind}${at}.`);
  }
  return parts.join(" ");
}

function scoreText(s: Score): string {
  const lines = [
    `Week from ${dayLabel(Date.parse(s.week_start))}: ${pct(s.score_pct)} of planned goal time spent (${dur(s.spent_minutes)} of ${dur(s.elapsed_minutes)} so far; ${dur(s.lost_minutes)} lost, ${dur(s.ahead_minutes)} still ahead, ${dur(s.planned_minutes)} planned).`,
    `${dayLabel(zone.startOfDay(s.date) + 12 * 3600_000)}: ${pct(s.day.score_pct)} (${dur(s.day.spent_minutes)} of ${dur(s.day.elapsed_minutes)}; ${dur(s.day.lost_minutes)} lost, ${dur(s.day.unverified_minutes)} unverified). Time won back: ${dur(s.day.time_won_back_minutes)}${s.day.time_won_back.reason ? ` (${s.day.time_won_back.reason})` : ""}.`,
    "Goals this week:",
    ...s.goals.map((g) =>
      g.scored
        ? `- ${g.category} "${g.title}": budget ${dur(g.budget_minutes)}, planned ${dur(g.planned_minutes)}, spent ${dur(g.spent_minutes)}, lost ${dur(g.lost_minutes)}, ${pct(g.score_pct)}`
        : `- ${g.category} "${g.title}": budget ${dur(g.budget_minutes)} (sleep, outside the score)`,
    ),
  ];
  if (s.day.blocks.length) {
    lines.push("Blocks that day:");
    for (const b of s.day.blocks) {
      const lost = b.lost
        .slice(0, 3)
        .map((l) => `${l.what} ${dur(l.minutes)}`)
        .join(", ");
      lines.push(
        `- ${span(b.start_at, b.end_at)} "${b.title}" for "${b.goal_title}": spent ${dur(b.spent_minutes)}, lost ${dur(b.lost_minutes)}${lost ? ` (${lost})` : ""}, ahead ${dur(b.ahead_minutes)}`,
      );
    }
  }
  return lines.join("\n");
}

function momentText(m: Moment): string {
  const t = m.totals;
  const lines = [
    `${m.kind === "morning" ? "Morning" : "Evening"}, ${m.day}: ${m.headline}`,
    `Today: ${dur(t.planned_minutes)} planned for goals, ${dur(t.spent_minutes)} spent, ${dur(t.lost_minutes)} lost, ${dur(t.won_back_minutes)} won back${t.baseline_lost_minutes == null ? "" : ` (usual loss ${dur(t.baseline_lost_minutes)} a day)`}.`,
    ...m.goals.map(
      (g) =>
        `- ${g.category} "${g.title}": ${dur(g.spent_week_minutes)} this week of ${g.budget_minutes == null ? "no budget" : dur(g.budget_minutes)}; today ${dur(g.planned_today_minutes)} planned, ${dur(g.spent_today_minutes)} spent`,
    ),
  ];
  if (m.at_risk) {
    const r = m.at_risk;
    lines.push(
      `Most at risk: ${span(r.start_at, r.end_at)} "${r.title}", usually ${dur(r.expected_lost_minutes)} lost${r.usual_trigger ? ` to ${r.usual_trigger}` : ""}.`,
    );
  }
  for (const s of m.suggestions) lines.push(`Move: ${s.title}. ${s.rationale}`);
  if (m.lesson) lines.push(`Lesson: ${m.lesson}`);
  if (m.first_move) lines.push(`Tomorrow's first move: ${m.first_move.title}. ${m.first_move.rationale}`);
  return lines.join("\n");
}

async function goalMap(): Promise<Map<string, Goal>> {
  return new Map((await store.listGoals()).map((g) => [g.id, g]));
}

async function doneText(r: Recommendation, verb: string): Promise<string> {
  const p = (r.action?.payload ?? {}) as { start_at?: string; end_at?: string };
  const at = typeof p.start_at === "string" ? ` ${span(p.start_at, p.end_at)}` : "";
  const until = await undoDeadline(r.id);
  return `${verb} "${r.title}"${at}. Undo with undo_recommendation (id ${r.id})${until ? ` until ${when(until)}` : ""}.`;
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "michael", version: "0.2.0" });
  // Agent scopes and the query log apply to every tool registered below (mcp-guard.ts).
  guardTools(server);

  // ---------- read ----------

  server.registerTool(
    "get_timeline",
    {
      title: "Get timeline",
      description: `The user's day as one timeline: calendar blocks, workouts, sleep, places, notes and conversations, plus Mac and iPhone screen activity. Use it to see what actually happened or what is planned. Give \`date\` for a whole local day, or \`from\`/\`to\`; default is the last 24 hours. Screen activity (app_usage, web_visit, screen) is counted, not listed, unless you ask for those types; use get_patterns or get_score for what took the time. Calendar lines say "with others" or "own time": Michael only ever changes own time. ${TZ_NOTE}`,
      inputSchema: {
        date: LocalDayInput.optional(),
        from: TimeInput.optional().describe("Start, inclusive"),
        to: TimeInput.optional().describe("End, inclusive"),
        source: z.array(Source).optional().describe("Only these sources"),
        type: z.array(EventType).optional().describe("Only these event types"),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ date, from, to, source, type }) => {
      let start: string;
      let end: string;
      if (date) {
        start = new Date(zone.startOfDay(date)).toISOString();
        end = new Date(zone.startOfDay(zone.nextDay(date)) - 1).toISOString();
      } else {
        end = to ? toInstant(to) : new Date().toISOString();
        start = from ? toInstant(from) : new Date(Date.parse(end) - 24 * 3600_000).toISOString();
      }
      if (!(Date.parse(end) > Date.parse(start)))
        throw new HttpError("bad_request", "`to` must be after `from`");
      const events = (await store.listEvents({ from: start, to: end, source, type })).sort(
        (a, b) => Date.parse(a.start_at) - Date.parse(b.start_at),
      );
      const listDevice = type?.some((t) => DEVICE_TYPES.includes(t)) ?? false;
      const listed = listDevice ? events : events.filter((e) => !DEVICE_TYPES.includes(e.type));
      const device = events.length - listed.length;
      const lines = [`Timeline ${span(start, end)}: ${events.length} events.`];
      lines.push(...listed.slice(0, MAX_LINES).map(eventLine));
      if (listed.length > MAX_LINES)
        lines.push(`... and ${listed.length - MAX_LINES} more. Narrow the range.`);
      if (device) lines.push(`Plus ${device} screen activity events (ask for those types to list them).`);
      if (!events.length) lines.push("Nothing recorded in that range.");
      return reply(lines.join("\n"), {
        from: start,
        to: end,
        count: events.length,
        truncated: events.length > MAX_EVENTS,
        events: events.slice(0, MAX_EVENTS),
      });
    }),
  );

  server.registerTool(
    "get_goals",
    {
      title: "Get goals",
      description:
        "The user's goals with their weekly time budgets (minutes). Categories: work, gym, rest, food. Read these before judging the day or proposing changes, and use the ids with update_goal, create_focus_block or add_event.",
      inputSchema: { active_only: z.boolean().optional().describe("Default true: leave out paused goals") },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ active_only }) => {
      const all = await store.listGoals();
      const goals = active_only === false ? all : all.filter((g) => g.active);
      const text = goals.length
        ? [`${goals.length} goals:`, ...goals.map(goalLine)].join("\n")
        : "No goals yet. Ask the user what they want this week to hold, then use add_goal.";
      return reply(text, { goals });
    }),
  );

  server.registerTool(
    "get_score",
    {
      title: "Get score",
      description:
        "The headline score: the share of planned goal time actually spent on the goals, for the week (Monday to Sunday) and for one day, with time won back, each goal's budget against what was planned and spent, and the day's blocks with what took the lost time. Use it to answer \"how is my day or week going\". Minutes throughout; `unverified` is spent time the data cannot prove. Default day is today in Europe/Athens.",
      inputSchema: { date: LocalDayInput.optional().describe("Local day, YYYY-MM-DD. Default today") },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ date }) => {
      const s = await scoreFor({ date });
      // The 5 minute ticks are for drawing the Today screen; models do not need them.
      const day = { ...s.day, blocks: s.day.blocks.map(({ ticks: _ticks, ...b }) => b) };
      return reply(scoreText(s), { ...s, day });
    }),
  );

  server.registerTool(
    "get_patterns",
    {
      title: "Get patterns",
      description: `Patterns in the user's timeline, with numbers: phone check cadence, focus disruptions and what they cost, repeat offenders, late screens, context switching, time by app and AI tool use. Use it for "where does my time go" and to back advice with maths. Default is the last 7 days. ${TZ_NOTE}`,
      inputSchema: {
        from: TimeInput.optional().describe("Start"),
        to: TimeInput.optional().describe("End"),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ from, to }) => {
      const report = await patternReportFor({
        from: from ? toInstant(from) : undefined,
        to: to ? toInstant(to) : undefined,
      });
      const text = report.headlines.length
        ? ["Headlines:", ...report.headlines.map((h) => `- ${h}`)].join("\n")
        : "Not enough data for patterns in that range.";
      return reply(`${text}\n\nFull report:\n${JSON.stringify(report)}`, report as Record<string, unknown>);
    }),
  );

  server.registerTool(
    "list_recommendations",
    {
      title: "List recommendations",
      description:
        "Michael's recommendations, newest first, each tied to a goal where it can be. Each says whether Michael can carry it out (own time only) or only advises (it involves other people). Status: proposed, accepted, dismissed, done (carried out), undone. Use the id with update_recommendation, execute_recommendation or undo_recommendation.",
      inputSchema: { status: RecommendationStatus.optional().describe("Only this status") },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ status }) => {
      const [recommendations, goals] = await Promise.all([store.listRecommendations({ status }), goalMap()]);
      const text = recommendations.length
        ? [
            `${recommendations.length} recommendations:`,
            ...recommendations.map((r) => recommendationLine(r, goals)),
          ].join("\n")
        : `No recommendations${status ? ` with status ${status}` : ""}.`;
      return reply(text, { recommendations });
    }),
  );

  server.registerTool(
    "get_nudges",
    {
      title: "Get nudges",
      description:
        "The nudges Michael sent (or held back) on one local day: at most 5 a day, under 15 words, each tied to a goal, with the maths behind it. Status: sent, queued, failed, suppressed (held back by the daily cap or quiet hours). Default day is today in Europe/Athens.",
      inputSchema: { date: LocalDayInput.optional().describe("Local day. Default today") },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ date }) => {
      const day = date ?? zone.dayOf(Date.now());
      const from = new Date(zone.startOfDay(day)).toISOString();
      const to = new Date(zone.startOfDay(zone.nextDay(day))).toISOString();
      const nudges = await store.listNudges({ from, to });
      const sent = nudges.filter((n) => n.status !== "suppressed").length;
      const text = nudges.length
        ? [
            `${sent} of 5 nudges used on ${day}:`,
            ...nudges.map(
              (n) =>
                `- ${zone.clock(Date.parse(n.created_at))} [${n.status}, ${n.channel}] "${n.text}" Because: ${n.reason}`,
            ),
          ].join("\n")
        : `No nudges on ${day}.`;
      return reply(text, { day, nudges });
    }),
  );

  server.registerTool(
    "get_moments",
    {
      title: "Get morning or evening moment",
      description:
        "Michael's Morning or Evening moment for today. Morning: what today holds against each goal's weekly budget, the stretch most likely to be lost and one or two moves. Evening: what happened against the plan, time won back and lost, one lesson and tomorrow's first move. Default: morning before 15:00 Europe/Athens, evening after.",
      inputSchema: { kind: MomentKind.optional().describe("morning or evening") },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ kind }) => {
      const k = kind ?? (zone.hourOf(Date.now()) < 15 ? "morning" : "evening");
      const m = await momentFor(k);
      return reply(momentText(m), m as Record<string, unknown>);
    }),
  );

  // ---------- write ----------

  server.registerTool(
    "add_event",
    {
      title: "Add event",
      description: `Log one thing on the user's timeline, such as a run, a meal, a note or a commitment they told you about. Use source "agent" and the closest type (workout, meal, note, ...). This only records; it never books calendar time (use create_focus_block for that) and never sends anything. start_at and end_at are ISO 8601 with an offset (Europe/Athens is +02:00 in winter).`,
      inputSchema: EventInput.shape,
    },
    safe(async (input) => {
      const { inserted, duplicates, ignored } = await store.insertEvents([parse(EventInput, input)]);
      const e = inserted[0];
      const text = e
        ? `Added to the timeline: ${span(e.start_at, e.end_at)} "${e.title}" (id ${e.id}).`
        : ignored
          ? "Not added: that source is switched off or the user is off the record."
          : "Already on the timeline.";
      return reply(text, { inserted: inserted.length, duplicates, ignored, events: inserted });
    }),
  );

  server.registerTool(
    "add_goal",
    {
      title: "Add goal",
      description:
        'Create a goal for the user, only when they asked for it or agreed to it. Category: work, gym, rest or food. weekly_budget_minutes is the time they want to give it each week (9 hours = 540). target is an optional measurable aim, e.g. { "gym_sessions_per_week": 4 } or { "sleep_hours": 8 }.',
      inputSchema: {
        category: GoalCategory,
        title: z.string().min(1).max(120).describe('Short, in the user\'s words, e.g. "Ship the pitch deck"'),
        description: z.string().max(500).optional(),
        weekly_budget_minutes: z.number().int().min(0).max(10080).optional().describe("Minutes per week"),
        target: z.record(z.string(), z.unknown()).optional(),
      },
    },
    safe(async (input) => {
      const goal = await store.createGoal(parse(GoalCreate, input));
      return reply(`Goal added.\n${goalLine(goal)}`, { goal });
    }),
  );

  server.registerTool(
    "update_goal",
    {
      title: "Update goal",
      description:
        "Change one of the user's goals: title, description, weekly budget (minutes), target or category. To stop a goal, set active to false (goals are never deleted from here). Give only the fields to change. Get the id from get_goals.",
      inputSchema: {
        id: Id.describe("Goal id from get_goals"),
        category: GoalCategory.optional(),
        title: z.string().min(1).max(120).optional(),
        description: z.string().max(500).nullable().optional(),
        weekly_budget_minutes: z.number().int().min(0).max(10080).nullable().optional(),
        target: z.record(z.string(), z.unknown()).nullable().optional(),
        active: z.boolean().optional().describe("false pauses the goal"),
      },
    },
    safe(async ({ id, ...patch }) => {
      const before = await store.getGoal(id);
      if (!before) throw new HttpError("not_found", "Goal not found");
      // Read before updating: the memory store hands out live objects.
      const oldBudget = before.weekly_budget_minutes;
      const goal = await store.updateGoal(id, parse(GoalUpdate, patch));
      if (!goal) throw new HttpError("not_found", "Goal not found");
      const changed =
        oldBudget !== goal.weekly_budget_minutes
          ? ` Weekly budget ${dur(oldBudget)} to ${dur(goal.weekly_budget_minutes)}.`
          : "";
      return reply(`Goal updated.${changed}\n${goalLine(goal)}`, { goal });
    }),
  );

  server.registerTool(
    "update_recommendation",
    {
      title: "Accept or dismiss a recommendation",
      description:
        "Record the user's answer to one of Michael's recommendations: accepted or dismissed. This changes nothing on the calendar; to carry an accepted one out, call execute_recommendation. A done recommendation cannot be dismissed: undo it first.",
      inputSchema: {
        id: Id.describe("Recommendation id from list_recommendations"),
        status: z.enum(["accepted", "dismissed"]),
      },
    },
    safe(async ({ id, status }) => {
      const rec = await store.getRecommendation(id);
      if (!rec) throw new HttpError("not_found", "Recommendation not found");
      if (rec.status === "done") {
        throw new HttpError("conflict", "That one is done. Undo it with undo_recommendation first.");
      }
      const saved = await store.updateRecommendationStatus(id, status);
      if (!saved) throw new HttpError("not_found", "Recommendation not found");
      return reply(`Marked "${saved.title}" as ${status}.`, { recommendation: saved });
    }),
  );

  server.registerTool(
    "execute_recommendation",
    {
      title: "Carry out a recommendation",
      description:
        "Carry out one of Michael's recommendations on the user's own calendar: book a focus block or move one of their solo blocks. Use it once the user says yes. Refused when it involves other people, has already started, or has nothing to carry out. Never deletes the user's events and never sends anything. The change can be undone with undo_recommendation until the block starts.",
      inputSchema: { id: Id.describe("Recommendation id from list_recommendations") },
    },
    safe(async ({ id }) => {
      const rec = await executeRecommendation(id);
      return reply(await doneText(rec, "Done:"), { recommendation: rec, undo_until: await undoDeadline(id) });
    }),
  );

  server.registerTool(
    "undo_recommendation",
    {
      title: "Undo a recommendation",
      description:
        "Put back what execute_recommendation or create_focus_block changed: removes the block Michael booked, or moves a moved block back. Works until the block starts. Only ever removes a block Michael created himself.",
      inputSchema: { id: Id.describe("Recommendation id") },
    },
    safe(async ({ id }) => {
      const rec = await undoRecommendation(id);
      return reply(`Undone: "${rec.title}" is back as it was.`, { recommendation: rec });
    }),
  );

  server.registerTool(
    "create_focus_block",
    {
      title: "Book a focus block",
      description: `Book a block of time on the user's own calendar for one of their goals (deep work, a gym session, a meal, a wind down), straight away. Use it when the user asks you to plan or protect time. Only in the future, 5 minutes to 6 hours, and never over an event with other people (refused: pick a free time; check get_timeline first). Tagged as Michael's, shown in Michael, and can be undone with undo_recommendation until it starts. ${TZ_NOTE}`,
      inputSchema: {
        start: TimeInput.describe("Start, e.g. 2026-11-14T15:00"),
        end: TimeInput.describe("End, e.g. 2026-11-14T16:30"),
        title: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe('Calendar title, e.g. "Focus: pitch deck". Default "Focus block"'),
        goal_id: Id.optional().describe("The goal it serves, from get_goals"),
      },
    },
    safe(async ({ start, end, title, goal_id }) => {
      const rec = await bookFocusBlock({
        start_at: toInstant(start),
        end_at: toInstant(end),
        title,
        goal_id,
        requested_by: currentAgent()?.name ?? "an AI tool",
      });
      return reply(await doneText(rec, "Booked"), {
        recommendation: rec,
        undo_until: await undoDeadline(rec.id),
      });
    }),
  );

  server.registerTool(
    "plan_travel",
    {
      title: "Plan travel",
      description:
        "Work out the drives between the user's calendar events with live traffic (Google Maps), put them on the timeline and propose leaving later or moving the user's own block past the rush. Defaults to today (Europe/Athens). Status maps_unavailable or travel_off means nothing was computed.",
      inputSchema: TravelPlanInput.shape,
    },
    safe(async (input) => {
      const plan = await travelPlanFor(TravelPlanInput.parse(input));
      return reply(JSON.stringify(plan, null, 2), plan as Record<string, unknown>);
    }),
  );

  return server;
}

// Stateless Streamable HTTP: a fresh server + transport per request (no session affinity needed on Railway).
export async function handleMcpRequest(req: Request): Promise<Response> {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
