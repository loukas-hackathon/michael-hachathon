import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import type { AgentClient, AgentQuery } from "@michael/shared";

// lib/agents.ts is server only and reads the caller's cookies; the counting below is pure. The
// marker package and the caller are stood in for, so the real module loads in a plain test.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    if (specifier === "./caller" && context.parentURL?.endsWith("/lib/agents.ts")) {
      return { url: "data:text/javascript,export const authHeaders=async()=>({})", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { countLine, groupByAgent, headline, isChange } = await import("./agents");

const CLAUDE = "40000000-0000-4000-8000-000000000001";
const claude: AgentClient = {
  id: CLAUDE,
  name: "Claude",
  status: "approved",
  scopes: ["timeline", "score", "write_events"],
  created_at: "2026-11-15T08:00:00+02:00",
  last_seen_at: "2026-11-15T10:33:00+02:00",
};
let n = 0;
const query = (tool: string, summary: string, over: Partial<AgentQuery> = {}): AgentQuery => ({
  id: `41000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  agent_id: CLAUDE,
  tool,
  summary,
  allowed: true,
  created_at: `2026-11-15T10:${String(10 + n).padStart(2, "0")}:00+02:00`,
  ...over,
});

test("a refused or empty write is a question, not a change (#330)", () => {
  // The review's log: one read, two bookings Michael refused, one that went through.
  const queries = [
    query("get_score", "Read your score", { changed: null }),
    query("create_focus_block", 'Tried to book "Past" for Sun 00:30. Refused: already started.', {
      changed: false,
    }),
    query(
      "create_focus_block",
      'Tried to book "Clash" for Sun 20:15. Refused: it overlaps an event with other people.',
      { changed: false },
    ),
    query("create_focus_block", 'Booked "Real" for Sun 10:32', {
      changed: true,
      recommendation_id: "42000000-0000-4000-8000-000000000001",
    }),
  ];
  assert.deepEqual(queries.map(isChange), [false, false, false, true]);
  const view = { sample: false, agents: [claude], queries };
  const [day] = groupByAgent(view);
  assert.ok(day);
  assert.equal(day.changes, 1);
  assert.equal(countLine(day), "4 questions, 1 change");
  assert.deepEqual(headline(view), { asked: [{ name: "Claude", times: "4 times" }], changes: 1 });
});

test("a line from before the field still counts as it did; not shared never counts", () => {
  const queries = [
    // Logged before `changed` existed: an allowed write was a change.
    query("create_focus_block", 'Booked "Sales focus" for Wed 15:00'),
    query("add_event", 'Added "Ran 5 km" to your day', { changed: null }),
    // Not shared with the agent, with and without the field.
    query("add_event", 'Added "Ran 5 km" to your day', { allowed: false, changed: false }),
    query("add_goal", 'Added the goal "Run"', { allowed: false }),
    // A read is never a change, whatever it carries.
    query("get_goals", "Read your goals"),
  ];
  assert.deepEqual(queries.map(isChange), [true, true, false, false, false]);
  const [day] = groupByAgent({ sample: false, agents: [claude], queries });
  assert.equal(day?.changes, 2);
  assert.equal(day && countLine(day), "5 questions, 2 changes");
  // Only questions: the count line says nothing about changes.
  const [reads] = groupByAgent({
    sample: false,
    agents: [claude],
    queries: [query("get_goals", "Read your goals")],
  });
  assert.equal(reads && countLine(reads), "1 question");
});
