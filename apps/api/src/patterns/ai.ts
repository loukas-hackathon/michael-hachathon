import type { AiToolUse } from "@michael/shared";
import { type Ctx, countedDays } from "./context";
import { type Detector, found, notEnough } from "./detector";
import { count, duration, pct, rate } from "./format";
import { SECOND } from "./time";
import { add, mins, ratio, round1, round2, type Span, sum, unionLength } from "./util";

const AI_MINIMUM =
  "at least one AI session in the range; the waiting share needs sessions that report waiting time";

interface Session extends Span {
  id: string;
  tool: string;
  /** Time the tool sat waiting for the user. Null when the session does not report it. */
  waitingMs: number | null;
}

/**
 * Time in AI sessions. Sessions often run side by side, so two figures are kept apart: session
 * time (each session in full) and time by the clock (overlaps counted once). Waiting is never
 * allowed to exceed the session it belongs to.
 */
export function aiToolUse(ctx: Ctx): Detector<AiToolUse> {
  const { zone } = ctx;
  const sessions: Session[] = [];
  for (const e of ctx.events) {
    if (e.type !== "ai_session" || !e.end_at) continue;
    const start = Date.parse(e.start_at);
    const end = Math.min(Date.parse(e.end_at), ctx.to);
    if (start < ctx.from || start >= ctx.to || !(end > start)) continue;
    const waiting = e.data.waiting_seconds;
    sessions.push({
      id: e.id,
      start,
      end,
      tool: typeof e.data.tool === "string" && e.data.tool ? e.data.tool : e.source,
      waitingMs:
        typeof waiting === "number" && Number.isFinite(waiting) && waiting >= 0
          ? Math.min(waiting * SECOND, end - start)
          : null,
    });
  }
  if (sessions.length === 0) return notEnough(AI_MINIMUM, "no AI sessions in this range");
  sessions.sort((a, b) => a.start - b.start);

  const waitingShare = (list: Session[]) => {
    const reported = list.filter((s) => s.waitingMs !== null);
    const time = sum(reported.map((s) => s.end - s.start));
    return reported.length > 0 && time > 0 ? round2(sum(reported.map((s) => s.waitingMs ?? 0)) / time) : null;
  };

  const countByDay = new Map<string, number>();
  const sessionMsByDay = new Map<string, number>();
  const spansByDay = new Map<string, Span[]>();
  for (const s of sessions) {
    add(countByDay, zone.dayOf(s.start), 1);
    for (const p of zone.splitByDay(s.start, s.end)) {
      add(sessionMsByDay, p.day, p.end - p.start);
      const list = spansByDay.get(p.day);
      if (list) list.push(p);
      else spansByDay.set(p.day, [p]);
    }
  }
  const withData = new Set(sessionMsByDay.keys());
  const daily = ctx.days
    .filter((d) => withData.has(d.day))
    .map((d) => ({
      day: d.day,
      sessions: countByDay.get(d.day) ?? 0,
      session_minutes: mins(sessionMsByDay.get(d.day) ?? 0),
      wall_minutes: mins(unionLength(spansByDay.get(d.day) ?? [])),
    }));

  const tools = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = tools.get(s.tool);
    if (list) list.push(s);
    else tools.set(s.tool, [s]);
  }
  const reported = sessions.filter((s) => s.waitingMs !== null);
  const counted = new Set(countedDays(ctx, withData));
  const rows = daily.filter((d) => counted.has(d.day));

  const data: AiToolUse = {
    days_with_data: withData.size,
    sessions: sessions.length,
    sessions_per_day: round1(ratio(sum(rows.map((d) => d.sessions)), rows.length)),
    session_minutes: mins(sum(sessions.map((s) => s.end - s.start))),
    wall_minutes: mins(unionLength(sessions)),
    waiting_minutes: reported.length > 0 ? mins(sum(reported.map((s) => s.waitingMs ?? 0))) : null,
    waiting_share: waitingShare(sessions),
    by_tool: [...tools.entries()]
      .map(([tool, list]) => ({
        tool,
        sessions: list.length,
        session_minutes: mins(sum(list.map((s) => s.end - s.start))),
        waiting_share: waitingShare(list),
      }))
      .sort((a, b) => b.session_minutes - a.session_minutes),
    daily,
  };

  const wallPerDay = ratio(sum(rows.map((d) => d.wall_minutes)), rows.length);
  const parts = [
    `AI tools open for ${duration(wallPerDay)} a day by the clock, ${rate(data.sessions_per_day)} sessions a day (${count(sessions.length, "session")}, ${duration(data.session_minutes)} of session time in total).`,
  ];
  if (data.waiting_share !== null) {
    parts.push(`${pct(data.waiting_share)} of session time was the tool waiting for the user.`);
  }
  const evidence = [...sessions].sort((a, b) => (b.waitingMs ?? 0) - (a.waitingMs ?? 0)).map((s) => s.id);
  return found(AI_MINIMUM, parts.join(" "), evidence, data);
}
