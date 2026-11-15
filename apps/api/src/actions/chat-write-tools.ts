import type Anthropic from "@anthropic-ai/sdk";
import {
  ChecklistItemCreate,
  ChecklistItemUpdate,
  type Goal,
  GoalCreate,
  goalKind,
  type LogTimeResponse,
  PlaceInput,
  type Recommendation,
  voiceShortDuration,
} from "@michael/shared";
import { z } from "zod";
import { addItem, updateItem } from "../checklist/items";
import { HttpError, parse } from "../http";
import { createInstruction, updateInstruction } from "../routes/instructions";
import { savePlaces } from "../routes/places";
import { updateProfile } from "../routes/profile";
import { store } from "../store";
import { executeRecommendation } from "./calendar";
import { logTime, settleBlock } from "./log";

// Michael writes everything the user can write in the app (#317), so "I took a bath for 40
// minutes" is logged, not explained away. Each tool goes through the same function as its REST
// route. What can be taken back is held by a recommendation (log_time, settle_block, change_goal)
// and undone with undo_action. Destructive things stay in the app: no tool deletes data, a goal,
// an instruction or a place, disconnects a source or revokes an agent.

export interface WriteOutcome {
  content: string;
  isError: boolean;
  action?: Recommendation;
}

const GOAL_UNDO_MS = 7 * 24 * 3600_000;

export const WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "log_done",
    description:
      "Log time the user says they already spent on a goal: 'I took a bath for 40 minutes at 13:00', 'did 30 min of reading', 'gym this morning, an hour'. It counts as confirmed goal time at once and can be undone. Name the goal by goal_id from the goals list, or by the words the user used (goal). Give minutes, and start_at when the user said when; without a start it ends just now. Past only, the last 14 days. Never ask the user to add a calendar block for this.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "The goal's id from the goals list" },
        goal: { type: "string", description: "The goal in the user's words, when you have no id" },
        minutes: { type: "integer", description: "How long, in minutes" },
        start_at: { type: "string", description: "When it started, ISO 8601 with offset (optional)" },
        end_at: { type: "string", description: "When it ended, ISO 8601 with offset (optional)" },
        note: { type: "string", description: "A few words in the user's words (optional)" },
      },
    },
  },
  {
    name: "confirm_block",
    description:
      "Settle one of the user's own past goal blocks from what they tell you: did=true when they did it (minutes when only part of it, from its start), did=false when they did not (reason in their words if they gave one; that time counts as lost). Use the event_id from today's list or find_calendar_blocks. It can be undone.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        did: { type: "boolean" },
        minutes: { type: "integer", description: "Minutes done, when only part of it (optional)" },
        reason: { type: "string", description: "Why not, in the user's words (optional)" },
      },
      required: ["event_id", "did"],
    },
  },
  {
    name: "add_goal",
    description:
      "Add a goal the user asks for. category is business, health or personal. A time goal has weekly_budget_minutes; a goal counted in sessions a week has per_week instead. calendar_titles are calendar block titles that count towards it.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        category: { type: "string", enum: ["business", "health", "personal"] },
        weekly_budget_minutes: { type: "integer" },
        per_week: { type: "integer", description: "Sessions a week, for a count goal" },
        calendar_titles: { type: "array", items: { type: "string" } },
        description: { type: "string" },
      },
      required: ["title", "category"],
    },
  },
  {
    name: "update_goal",
    description:
      "Change one of the user's goals when they ask: its weekly budget, its title or description, or pause it (active=false) or resume it (active=true). A budget or pause can be undone for a week. Goals are never deleted here; deleting is in the app.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string" },
        weekly_budget_minutes: { type: "integer" },
        active: { type: "boolean" },
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["goal_id"],
    },
  },
  {
    name: "add_checklist_item",
    description:
      "Add one of today's outcomes (one to three a day) to a checklist goal, in the user's own words. goal_id of the checklist goal; date YYYY-MM-DD, default today.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string" },
        text: { type: "string" },
        date: { type: "string" },
      },
      required: ["goal_id", "text"],
    },
  },
  {
    name: "update_checklist_item",
    description:
      "Tick off (status done), drop (status dropped), reopen (status open) or reword one outcome, only when the user says so. item_id from the context.",
    input_schema: {
      type: "object",
      properties: {
        item_id: { type: "string" },
        status: { type: "string", enum: ["open", "done", "dropped"] },
        text: { type: "string" },
      },
      required: ["item_id"],
    },
  },
  {
    name: "add_instruction",
    description:
      "Keep a standing instruction the user gives, a ground rule Michael never plans against: kind clear_day with days (0 Sunday to 6 Saturday), home_by with time HH:MM, quiet_hours with time and end_time, or custom with only text.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        kind: { type: "string", enum: ["clear_day", "home_by", "quiet_hours", "custom"] },
        days: { type: "array", items: { type: "integer" } },
        time: { type: "string" },
        end_time: { type: "string" },
      },
      required: ["text"],
    },
  },
  {
    name: "update_instruction",
    description:
      "Pause (active=false), resume or reword one standing instruction when the user asks, by its instruction_id. Deleting is in the app.",
    input_schema: {
      type: "object",
      properties: {
        instruction_id: { type: "string" },
        active: { type: "boolean" },
        text: { type: "string" },
        days: { type: "array", items: { type: "integer" } },
        time: { type: "string" },
        end_time: { type: "string" },
      },
      required: ["instruction_id"],
    },
  },
  {
    name: "save_place",
    description:
      "Save or change one of the user's places for travel times, e.g. key 'gym' with the address they gave. Other saved places stay as they are.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Short slug: home, work, gym, university" },
        label: { type: "string" },
        address: { type: "string" },
      },
      required: ["key", "address"],
    },
  },
  {
    name: "update_profile",
    description:
      "Change the user's usual week when they ask: quiet_hours and work_hours as {start, end} in HH:MM, work_days and gym_days as mon..sun, fixed_titles (calendar titles Michael never moves). Only the fields given change.",
    input_schema: {
      type: "object",
      properties: {
        quiet_hours: {
          type: "object",
          properties: { start: { type: "string" }, end: { type: "string" } },
        },
        work_hours: {
          type: "object",
          properties: { start: { type: "string" }, end: { type: "string" } },
        },
        work_days: { type: "array", items: { type: "string" } },
        gym_days: { type: "array", items: { type: "string" } },
        fixed_titles: { type: "array", items: { type: "string" } },
      },
    },
  },
];

export const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));

const logged = (r: LogTimeResponse): WriteOutcome => ({
  content: `${r.message} Entry ${r.entry.id}, recommendation id ${r.recommendation.id}. Say it in one line with these numbers and end with "Undo".`,
  isError: false,
  action: r.recommendation,
});

const GoalPatch = z.object({
  goal_id: z.uuid(),
  weekly_budget_minutes: z
    .number()
    .int()
    .nonnegative()
    .max(7 * 24 * 60)
    .optional(),
  active: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(500).optional(),
});

const AddGoal = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.enum(["business", "health", "personal"]),
  weekly_budget_minutes: z.number().int().nonnegative().optional(),
  per_week: z.number().int().positive().max(50).optional(),
  calendar_titles: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  description: z.string().trim().max(500).optional(),
});

async function addGoal(input: unknown): Promise<WriteOutcome> {
  const p = parse(AddGoal, input);
  const target: Record<string, unknown> = {};
  if (p.per_week) Object.assign(target, { kind: "count", per_week: p.per_week });
  if (p.calendar_titles?.length) target.calendar_titles = p.calendar_titles;
  const goal = await store.createGoal(
    parse(GoalCreate, {
      title: p.title,
      category: p.category,
      description: p.description ?? null,
      target: Object.keys(target).length ? target : null,
      weekly_budget_minutes: p.per_week ? null : (p.weekly_budget_minutes ?? null),
    }),
  );
  const what =
    goalKind(goal) === "count"
      ? `${p.per_week} times a week`
      : goal.weekly_budget_minutes
        ? `${voiceShortDuration(goal.weekly_budget_minutes)} a week`
        : "no weekly budget yet";
  return { content: `Added the goal ${goal.title}, ${what} {goal_id ${goal.id}}.`, isError: false };
}

async function updateGoal(input: unknown): Promise<WriteOutcome> {
  const p = parse(GoalPatch, input);
  const goal = await store.getGoal(p.goal_id);
  if (!goal) throw new HttpError("not_found", "Goal not found");
  const said: string[] = [];
  let action: Recommendation | undefined;
  // Budget and pause go through a change_goal recommendation, so undo_action puts them back.
  if (p.weekly_budget_minutes !== undefined || p.active !== undefined) {
    const change = {
      goal_id: goal.id,
      ...(p.weekly_budget_minutes !== undefined ? { weekly_budget_minutes: p.weekly_budget_minutes } : {}),
      ...(p.active !== undefined ? { active: p.active } : {}),
    };
    const parts = [
      p.weekly_budget_minutes !== undefined
        ? `${voiceShortDuration(goal.weekly_budget_minutes ?? 0)} to ${voiceShortDuration(p.weekly_budget_minutes)} a week`
        : null,
      p.active === false ? "paused" : p.active === true ? "resumed" : null,
    ].filter(Boolean);
    const rec = await store.createRecommendation({
      goal_id: goal.id,
      title: `${goal.title}: ${parts.join(", ")}`,
      rationale: "Asked for in chat.",
      action: {
        kind: "change_goal",
        payload: { changes: [change], reason: "Asked for in chat." },
        involves_others: false,
        undo_until: new Date(Date.now() + GOAL_UNDO_MS).toISOString(),
      },
      source: "chat",
    });
    try {
      action = await executeRecommendation(rec.id);
    } catch (err) {
      await store.updateRecommendationStatus(rec.id, "dismissed").catch(() => null);
      throw err;
    }
    said.push(`${action.title}. Recommendation id ${action.id}`);
  }
  if (p.title !== undefined || p.description !== undefined) {
    const updated = (await store.updateGoal(goal.id, {
      ...(p.title !== undefined ? { title: p.title } : {}),
      ...(p.description !== undefined ? { description: p.description } : {}),
    })) as Goal;
    said.push(`Now called ${updated.title}`);
  }
  if (said.length === 0)
    return { content: "Nothing to change: give a budget, active, title or description.", isError: true };
  return { content: `Done: ${said.join(". ")}.`, isError: false, action };
}

const ItemPatch = z.object({ item_id: z.uuid() }).and(ChecklistItemUpdate);

async function addChecklist(input: unknown): Promise<WriteOutcome> {
  const item = await addItem(parse(ChecklistItemCreate, input));
  return { content: `Added "${item.text}" for ${item.date} {item_id ${item.id}}.`, isError: false };
}

async function updateChecklist(input: unknown): Promise<WriteOutcome> {
  const { item_id, ...patch } = parse(ItemPatch, input);
  const item = await updateItem(item_id, patch, "user");
  return { content: `"${item.text}" is ${item.status}.`, isError: false };
}

async function addInstruction(input: unknown): Promise<WriteOutcome> {
  const i = await createInstruction(input);
  return { content: `Kept: ${i.text} {instruction_id ${i.id}}.`, isError: false };
}

const InstructionPatch = z.object({ instruction_id: z.uuid() }).passthrough();

async function changeInstruction(input: unknown): Promise<WriteOutcome> {
  const { instruction_id, ...patch } = parse(InstructionPatch, input);
  const i = await updateInstruction(instruction_id, patch);
  return { content: `${i.text}: ${i.active ? "active" : "paused"}.`, isError: false };
}

async function savePlace(input: unknown): Promise<WriteOutcome> {
  const place = parse(PlaceInput, input);
  const others = (await store.listPlaces()).filter((p) => p.key !== place.key);
  const res = await savePlaces({
    places: [
      ...others.map((p) => ({ key: p.key, label: p.label, address: p.address, lat: p.lat, lng: p.lng })),
      place,
    ],
  });
  const saved = res.places.find((p) => p.key === place.key);
  return {
    content: `Saved ${saved?.label ?? place.key}: ${saved?.address ?? place.address ?? "no address"}.${
      res.maps_available ? "" : " Travel times need the maps key on the server."
    }`,
    isError: false,
  };
}

async function changeProfile(input: unknown): Promise<WriteOutcome> {
  const p = await updateProfile(input);
  return {
    content: `Saved. Quiet hours ${p.quiet_hours.start} to ${p.quiet_hours.end}, work ${p.work_hours.start} to ${p.work_hours.end} on ${p.work_days.join(", ") || "no days"}.`,
    isError: false,
  };
}

/** Runs one write tool; HttpError refusals are turned into tool errors by the caller. */
export async function runWriteTool(name: string, input: unknown): Promise<WriteOutcome | null> {
  switch (name) {
    case "log_done":
      return logged(await logTime(input, "chat", executeRecommendation));
    case "confirm_block":
      return logged(await settleBlock(input, "chat", executeRecommendation));
    case "add_goal":
      return addGoal(input);
    case "update_goal":
      return updateGoal(input);
    case "add_checklist_item":
      return addChecklist(input);
    case "update_checklist_item":
      return updateChecklist(input);
    case "add_instruction":
      return addInstruction(input);
    case "update_instruction":
      return changeInstruction(input);
    case "save_place":
      return savePlace(input);
    case "update_profile":
      return changeProfile(input);
    default:
      return null;
  }
}
