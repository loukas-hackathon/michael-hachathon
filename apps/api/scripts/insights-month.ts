// Prints a hand made month of events (apps/api/src/insights/testkit.ts) as a body for
// POST /v1/events/batch, to try the insights engine on a local API:
//
//   pnpm --filter @michael/api exec tsx scripts/insights-month.ts <goal id> > month.json
//   curl -X POST localhost:8787/v1/events/batch -H "Authorization: Bearer dev-key" \
//     -H "content-type: application/json" -d @month.json
//
// The 30 days end yesterday. Pass the id of a business goal of kind `time` on the account, so
// the morning blocks count towards it. A second argument "plain" fills the same columns
// independently: nothing should be found.
import { plantedMonth } from "../src/insights/testkit";

const goalId = process.argv[2];
const first = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
const month = plantedMonth({ firstDay: first, days: 30, seed: 7, planted: process.argv[3] !== "plain" });
const events = month.inputs.map((e) =>
  e.data?.goal_id && goalId ? { ...e, data: { ...e.data, goal_id: goalId } } : e,
);
console.log(JSON.stringify({ events }));
