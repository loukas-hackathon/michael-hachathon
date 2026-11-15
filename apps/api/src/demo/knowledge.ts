import type { CheckInValue } from "@michael/shared";
import { Zone } from "../patterns/time";
import type { NewCheckIn, Store } from "../store";
import { DEMO_TZ } from "./time";

// "What I know about you" on the demo week (#379): a few things the user told Michael in chat and
// one check in answer from yesterday, so the page has something true to show on stage. Generic,
// no private names. Idempotent: memories are seeded events with stable ids under their own
// prefix (never touched by the week's "demo:" sync), and check ins have fixed keys per day.
// A reset also removes memories added during a rehearsal; a forgotten one comes back on the next refresh.

export const MEMORY_PREFIX = "demomem:";
const CHECK_IN_PREFIX = "demo-know:";
const HOUR = 3_600_000;

const MEMORIES: { key: string; text: string; day: number; hour: number }[] = [
  { key: "exams", text: "Exams start 1 December", day: 0, hour: 21 },
  { key: "mornings", text: "Prefers training before 08:00", day: 1, hour: 8.5 },
  { key: "fridays", text: "Friday evenings are for family", day: 3, hour: 19 },
];

type CheckInSeed = Pick<NewCheckIn, "kind" | "question" | "answer_type"> & {
  key: string;
  from: number;
  to: number;
  answer: CheckInValue;
  label: string | null;
};

const CHECK_INS: CheckInSeed[] = [
  {
    key: "meeting",
    kind: "unaccounted",
    question: "14:00 to 15:10 is unaccounted for on your Mac. Were you in a meeting?",
    answer_type: "yes_no",
    from: 14,
    to: 15 + 10 / 60,
    answer: "yes",
    label: "meeting",
  },
];

/** `days` oldest first, the last one today (buildDemoWeek). */
export async function seedDemoKnowledge(store: Store, days: string[], opts: { reset: boolean }) {
  const today = days.at(-1);
  if (!today) return;
  const zone = new Zone(DEMO_TZ);
  const yesterday = zone.nextDay(today, -1);
  const at = (day: string, hour: number) => new Date(zone.startOfDay(day) + hour * HOUR).toISOString();

  if (opts.reset) {
    const now = Date.now();
    const rehearsal = await store.listEvents({
      from: new Date(now - 366 * 24 * HOUR).toISOString(),
      to: new Date(now + 60_000).toISOString(),
      type: ["memory"],
    });
    const drop = rehearsal.filter((e) => !e.external_id?.startsWith(MEMORY_PREFIX)).map((e) => e.id);
    if (drop.length) await store.deleteEvents(drop);
  }

  await store.syncSeededEvents(
    MEMORY_PREFIX,
    ["manual"],
    MEMORIES.map((m) => ({
      source: "manual" as const,
      type: "memory" as const,
      start_at: at(days[Math.min(m.day, days.length - 1)] ?? today, m.hour),
      end_at: null,
      title: m.text,
      data: { origin: "chat" },
      external_id: `${MEMORY_PREFIX}${m.key}`,
    })),
  );

  // Yesterday's answers only: older demo rows go, so they never pile up as the week moves on.
  const rows = await store.listCheckIns({ fromDay: zone.nextDay(yesterday, -14), toDay: yesterday });
  for (const r of rows) {
    if (!r.key.startsWith(CHECK_IN_PREFIX)) continue;
    if (r.day !== yesterday) await store.deleteCheckIn(r.id);
  }
  await store.createCheckIns(
    CHECK_INS.map((c) => ({
      key: `${CHECK_IN_PREFIX}${c.key}:${yesterday}`,
      day: yesterday,
      kind: c.kind,
      question: c.question,
      answer_type: c.answer_type,
      moment: "evening",
      event_id: null,
      goal_id: null,
      start_at: at(yesterday, c.from),
      end_at: at(yesterday, c.to),
      follow_up_of: null,
    })),
  );
  const mine = await store.listCheckIns({ fromDay: yesterday, toDay: yesterday });
  for (const c of CHECK_INS) {
    const row = mine.find((r) => r.key === `${CHECK_IN_PREFIX}${c.key}:${yesterday}`);
    if (row && row.answer === null) await store.answerCheckIn(row.id, { answer: c.answer, label: c.label });
  }
}
