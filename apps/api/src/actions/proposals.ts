import type Anthropic from "@anthropic-ai/sdk";
import {
  type ChangeGoalPayload,
  type Event,
  type Goal,
  GoalChange,
  IsoDateTime,
  type PlanChangePayload,
  PlanStep,
  type Recommendation,
  type RecommendationAction,
  voiceDuration,
} from "@michael/shared";
import { z } from "zod";
import { refusalFor } from "../instructions/guard";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { store } from "../store";

// Proposals from chat (#188): when the user tells Michael something that changes their week ("I
// have exams from 1 December", "my knee hurts"), he proposes one concrete change to a goal or to
// the plan. Nothing changes here: the proposal is a recommendation with status "proposed" that the
// user accepts with one tap (POST /v1/recommendations/:id/execute) or declines (status dismissed).
// Accepting runs the same executor as every other action, with undo.

/** A proposal the user declined is not made again for this long. */
export const DECLINED_QUIET_MS = 7 * 24 * 3600_000;
const MAX_UNTIL_MS = 16 * 7 * 24 * 3600_000;

export const PROPOSAL_TOOLS: Anthropic.Tool[] = [
  {
    name: "propose_goal_change",
    description:
      "Propose changing one or more goals' weekly budgets (or pausing a goal) because of something the user told you, for example exams coming up or an injury. Nothing changes until the user taps Accept. Use goal ids from the goals list. Give `until` for a temporary change (the old values come back then). At most one proposal per answer. After calling it, say the change in one short line with the maths and tell the user to tap Accept.",
    input_schema: {
      type: "object",
      properties: {
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              goal_id: { type: "string" },
              weekly_budget_minutes: {
                type: "integer",
                description: "New weekly budget in minutes, e.g. 480 for 8h",
              },
              active: { type: "boolean", description: "false pauses the goal" },
            },
            required: ["goal_id"],
          },
          description: "One entry per goal to change, at most 5",
        },
        until: {
          type: "string",
          description: "ISO 8601 with offset: when the old values come back. Omit for a lasting change.",
        },
        title: {
          type: "string",
          description:
            "The proposal in under 15 words, numbers first, e.g. 'University 8h a week until 22 December, Business 4h'",
        },
        reason: { type: "string", description: "What the user told you, in a line" },
      },
      required: ["changes", "title", "reason"],
    },
  },
  {
    name: "propose_plan_change",
    description:
      "Propose a set of changes to the user's own calendar, accepted together with one tap: move or rename their own solo blocks (move_calendar_block) and add new blocks (create_focus_block). For example swap this week's runs for swims after a knee injury. Never events with other people, nothing that has started. Find block ids with find_calendar_blocks first. At most 10 steps and one proposal per answer. After calling it, say the change in one short line and tell the user to tap Accept.",
    input_schema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["move_calendar_block", "create_focus_block"] },
              event_id: { type: "string", description: "move_calendar_block: the block's id" },
              start_at: {
                type: "string",
                description: "ISO 8601 with offset; required for create_focus_block",
              },
              end_at: {
                type: "string",
                description: "ISO 8601 with offset; required for create_focus_block",
              },
              new_title: { type: "string", description: "move_calendar_block: rename, e.g. 'Swim'" },
              title: { type: "string", description: "create_focus_block: the new block's title" },
            },
            required: ["kind"],
          },
        },
        goal_id: { type: "string", description: "The goal this plan serves, from the goals list (optional)" },
        title: {
          type: "string",
          description: "The proposal in under 15 words, e.g. 'Swap 3 runs for swims this week'",
        },
        reason: { type: "string", description: "What the user told you, in a line" },
      },
      required: ["steps", "title", "reason"],
    },
  },
];

const GoalInput = z.object({
  changes: z.array(GoalChange).min(1).max(5),
  until: IsoDateTime.nullish(),
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(500),
});
const PlanInput = z.object({
  steps: z.array(PlanStep).min(1).max(10),
  goal_id: z.string().nullish(),
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(500),
});

export interface ProposalOutcome {
  content: string;
  isError: boolean;
  action?: Recommendation;
}

const fail = (content: string): ProposalOutcome => ({ content, isError: true });
const invalid = (err: z.ZodError) =>
  fail(`Invalid input: ${err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
const isOthers = (e: Event) => e.data.with_others === true || Number(e.data.attendees ?? 0) >= 2;
const budget = (m: number | null | undefined) => (m ? voiceDuration(m) : "no budget");

/** A dismissed chat proposal of the same kind, about the same goals or blocks, in the last week. */
async function declinedRecently(
  kind: RecommendationAction["kind"],
  ids: string[],
): Promise<Recommendation | null> {
  const since = Date.now() - DECLINED_QUIET_MS;
  const dismissed = await store.listRecommendations({ status: "dismissed" });
  return (
    dismissed.find((r) => {
      if (r.source !== "chat" || r.action?.kind !== kind || Date.parse(r.updated_at) < since) return false;
      const p = r.action.payload as Partial<ChangeGoalPayload & PlanChangePayload>;
      const theirs =
        kind === "change_goal"
          ? (p.changes ?? []).map((c) => c.goal_id)
          : (p.steps ?? []).flatMap((s) => (s.kind === "move_calendar_block" ? [s.event_id] : []));
      return theirs.some((id) => ids.includes(id));
    }) ?? null
  );
}

async function proposeGoalChange(input: unknown): Promise<ProposalOutcome> {
  const p = GoalInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { changes, until, title, reason } = p.data;
  if (until && (Date.parse(until) <= Date.now() || Date.parse(until) > Date.now() + MAX_UNTIL_MS)) {
    return fail("`until` must be in the future and within 16 weeks");
  }
  const goals = await Promise.all(changes.map((c) => store.getGoal(c.goal_id)));
  const missing = changes.find((_, i) => !goals[i]);
  if (missing) return fail(`No goal with id ${missing.goal_id}. Use ids from the goals list.`);
  const ids = changes.map((c) => c.goal_id);
  const declined = await declinedRecently("change_goal", ids);
  if (declined) {
    return fail(`The user declined "${declined.title}" this week. Do not propose it again; advise instead.`);
  }

  const lines = changes.map((c, i) => {
    const g = goals[i] as Goal;
    if (c.active === false) return `${g.title}: paused`;
    if (c.weekly_budget_minutes !== undefined)
      return `${g.title}: ${budget(g.weekly_budget_minutes)} to ${budget(c.weekly_budget_minutes)} a week`;
    return `${g.title}: changed`;
  });
  const zone = new Zone(DEFAULT_TIMEZONE);
  const untilText = until ? `, until ${zone.dayOf(Date.parse(until))}` : "";
  const payload: ChangeGoalPayload = { changes, until: until ?? null, reason };
  const rec = await store.createRecommendation({
    goal_id: ids[0] ?? null,
    title,
    rationale: `${reason} Proposed in chat: ${lines.join("; ")}${untilText}.`,
    action: { kind: "change_goal", payload, involves_others: false, undo_until: until ?? null },
    source: "chat",
  });
  return {
    content: `Proposed, not applied: ${lines.join("; ")}${untilText}. Recommendation id ${rec.id}. The user taps Accept to apply it or Not now to drop it.`,
    isError: false,
    action: rec,
  };
}

async function proposePlanChange(input: unknown): Promise<ProposalOutcome> {
  const p = PlanInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { steps, title, reason } = p.data;
  const now = Date.now();
  const zone = new Zone(DEFAULT_TIMEZONE);
  const instructions = await store.listInstructions().catch(() => []);
  const starts: number[] = [];
  const lines: string[] = [];
  for (const [i, s] of steps.entries()) {
    const n = i + 1;
    if (s.kind === "move_calendar_block") {
      const e = await store.getEvent(s.event_id);
      if (e?.type !== "calendar_event") return fail(`Step ${n}: no calendar block with id ${s.event_id}`);
      if (isOthers(e)) return fail(`Step ${n}: "${e.title}" has other people in it. Advice only.`);
      if (Date.parse(e.start_at) <= now) return fail(`Step ${n}: "${e.title}" has already started`);
      if (!s.start_at && !s.end_at && !s.new_title)
        return fail(`Step ${n}: give start_at, end_at or new_title`);
      if (s.start_at && Date.parse(s.start_at) <= now)
        return fail(`Step ${n}: the new time has already started`);
      starts.push(Date.parse(e.start_at), ...(s.start_at ? [Date.parse(s.start_at)] : []));
      const to = s.start_at
        ? ` to ${zone.dayOf(Date.parse(s.start_at))} ${zone.clock(Date.parse(s.start_at))}`
        : "";
      lines.push(
        `${e.title} ${zone.dayOf(Date.parse(e.start_at))} ${zone.clock(Date.parse(e.start_at))}${s.new_title ? ` becomes ${s.new_title}` : ""}${to}`,
      );
    } else {
      const start = Date.parse(s.start_at);
      if (start <= now) return fail(`Step ${n}: that time has already started`);
      if (Date.parse(s.end_at) <= start) return fail(`Step ${n}: end_at must be after start_at`);
      starts.push(start);
      lines.push(
        `new ${s.title ?? "Focus block"} ${zone.dayOf(start)} ${zone.clock(start)} to ${zone.clock(Date.parse(s.end_at))}`,
      );
    }
    const { kind, ...payload } = s;
    const verdict = await refusalFor(
      { kind, payload, involves_others: false, undo_until: null },
      { instructions, getEvent: (id) => store.getEvent(id) },
    );
    if (!verdict.allowed) return fail(`Step ${n}: ${verdict.reason}`);
  }
  const blockIds = steps.flatMap((s) => (s.kind === "move_calendar_block" ? [s.event_id] : []));
  const declined = blockIds.length ? await declinedRecently("plan_change", blockIds) : null;
  if (declined) {
    return fail(`The user declined "${declined.title}" this week. Do not propose it again; advise instead.`);
  }

  const goal =
    p.data.goal_id && z.uuid().safeParse(p.data.goal_id).success ? await store.getGoal(p.data.goal_id) : null;
  const payload: PlanChangePayload = { steps, reason };
  const rec = await store.createRecommendation({
    goal_id: goal?.id ?? null,
    title,
    rationale: `${reason} Proposed in chat: ${lines.join("; ")}.`,
    action: {
      kind: "plan_change",
      payload,
      involves_others: false,
      undo_until: new Date(Math.min(...starts)).toISOString(),
    },
    source: "chat",
  });
  return {
    content: `Proposed, not applied: ${lines.join("; ")}. Recommendation id ${rec.id}. The user taps Accept to apply it or Not now to drop it.`,
    isError: false,
    action: rec,
  };
}

export async function runProposalTool(name: string, input: unknown): Promise<ProposalOutcome | null> {
  if (name === "propose_goal_change") return proposeGoalChange(input);
  if (name === "propose_plan_change") return proposePlanChange(input);
  return null;
}
