import { type PersonalRecord, WeekPlanInput, type WeekReview, WeekReviewQuery } from "@michael/shared";
import { Hono } from "hono";
import { currentUserId } from "../context";
import { bookGoalTime } from "../goals/book";
import { HttpError, parse } from "../http";
import { Zone } from "../patterns/time";
import { outcomesGoal } from "../ritual/ritual";
import { isScoredGoal } from "../score";
import { store } from "../store";
import { phraseLesson } from "../week/phrase";
import { computeReview } from "../week/review";
import { loadWeek, scoreOfWeek } from "./score";

// Your week (#376): the one place that reads the store for the review; week/review.ts stays pure.
// A read only path: records are read, never synced, and no offers are made, so opening the review
// writes nothing (the score's own reads keep the records current).

const iso = (ms: number) => new Date(ms).toISOString();

export async function weekReviewFor(query: { week?: string; now?: string } = {}): Promise<WeekReview> {
  const q = parse(WeekReviewQuery, query);
  const loaded = await loadWeek({ date: q.week, now: q.now });
  const zone = new Zone(loaded.score.timezone);
  const monday = zone.dayOf(Date.parse(loaded.score.week_start));
  const nextMonday = zone.nextDay(monday, 7);
  const [score, records, targets, nextEvents, instructions, outcomes] = await Promise.all([
    scoreOfWeek(loaded, { readOnly: true }),
    store.listRecords().catch((err) => {
      console.error("week review: records", err);
      return [] as PersonalRecord[];
    }),
    store.listTargets(zone.nextDay(monday, -28), nextMonday).catch(() => []),
    store.listEvents({
      from: iso(zone.startOfDay(nextMonday)),
      to: iso(zone.startOfDay(zone.nextDay(nextMonday, 7))),
      type: ["calendar_event"],
    }),
    store.listInstructions().catch(() => []),
    outcomesGoal(false).catch(() => null),
  ]);
  const core = computeReview({
    score,
    history: loaded.history,
    goals: loaded.goals,
    records,
    targets,
    events: loaded.events,
    checklist: loaded.checklist,
    outcomesGoalId: outcomes?.id ?? null,
    nextEvents,
    instructions,
    now: loaded.now,
  });
  const phrased = await phraseLesson(core, `${currentUserId()}:week:${core.week_start}`);
  return { ...core, ...phrased };
}

export const week = new Hono()
  // GET /v1/week/review?week=YYYY-MM-DD&now=<iso>   (default: this week, Europe/Athens)
  .get("/week/review", async (c) => {
    return c.json(await weekReviewFor({ week: c.req.query("week"), now: c.req.query("now") }));
  })
  // POST /v1/week/plan { goal_id, minutes }: next week's first goal block, through Book (#309),
  // undoable until it starts.
  .post("/week/plan", async (c) => {
    const body = parse(WeekPlanInput, await c.req.json().catch(() => null));
    const goal = await store.getGoal(body.goal_id);
    if (!goal?.active || !isScoredGoal(goal)) throw new HttpError("not_found", "Goal not found");
    return c.json(await bookGoalTime(goal.id, body.minutes, Date.now(), { nextWeek: true }), 201);
  });
