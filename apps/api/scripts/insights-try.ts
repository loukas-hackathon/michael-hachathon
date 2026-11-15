import { buildInsights } from "../src/insights";
import { asEvents, plantedMonth } from "../src/insights/testkit";

const planted = process.argv[2] !== "noise";
const seed = Number(process.argv[3] ?? 7);
const month = plantedMonth({ firstDay: "2026-10-15", days: 30, seed, planted });
const t0 = performance.now();
const study = buildInsights({
  events: asEvents(month.inputs),
  goals: month.goals,
  from: "2026-10-14T21:00:00Z",
  to: month.end,
  now: month.end,
});
console.error(`${Math.round(performance.now() - t0)} ms, ${month.inputs.length} events, late nights ${month.lateNights.length}`);
const { series, ...rest } = study.response;
console.log(JSON.stringify(rest, null, 1));
