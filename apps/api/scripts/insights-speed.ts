import { buildFeatures, buildInsights } from "../src/insights";
import { goal, syntheticMonth } from "../src/patterns/testkit";

const days = Number(process.argv[2] ?? 84);
const events = syntheticMonth(days, "2026-08-22T00:00:00+03:00");
const to = new Date(Date.parse("2026-08-22T00:00:00+03:00") + days * 86_400_000).toISOString();
const input = { events, goals: [goal("business", "00000000-0000-4000-8000-00000000a001")], from: "2026-08-22T00:00:00+03:00", to, now: to };
let t0 = performance.now();
buildFeatures(input);
console.log(`${events.length} events, features ${Math.round(performance.now() - t0)} ms`);
t0 = performance.now();
const study = buildInsights(input);
console.log(`insights ${Math.round(performance.now() - t0)} ms`, study.response.studied, study.response.insights.map((i) => i.id));
