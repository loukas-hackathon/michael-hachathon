import { z } from "zod";
import { formatMinutes, type MappedEvent, round } from "./common";

// Health Auto Export (iOS app, "REST API" automation) -> sleep, workout and biometric events.
// Format: https://help.healthyapps.dev/en/health-auto-export/export-format (health metrics and
// workouts subpages). The body is `{ data: { metrics: [...], workouts: [...] } }`; other arrays
// (state of mind, medications, ECG, ...) are ignored. Dates look like "2024-02-06 14:30:00 -0800".
//
// Schemas are lenient on purpose: the app adds fields between versions, and one odd sample must
// not lose the rest of an export. Each metric, sample and workout is parsed on its own and skipped
// when it does not fit. Only the fields named below are read; routes (GPS) are never stored.

const SOURCE = "health_auto_export" as const;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
// A night summarised while the person is still asleep is incomplete, and a later export cannot
// update it (ingest is insert once). So a sleep is only stored once it ended this long ago.
export const SLEEP_SETTLE_MS = 20 * 60_000;
// Unsummarised sleep segments further apart than this belong to different nights.
const NIGHT_GAP_MS = 3 * HOUR;

/** "2024-02-06 14:30:00 -0800" (or an ISO string) -> epoch ms, or null. */
export function parseHaeDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = value
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?$/);
  const iso = m
    ? `${m[1]}T${m[2]}${m[3] ? (m[3] === "Z" ? "Z" : `${m[3].slice(0, 3)}:${m[3].slice(-2)}`) : ""}`
    : value;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

const iso = (ms: number) => new Date(ms).toISOString();
const num = z.coerce.number().refine(Number.isFinite);
const optNum = num.optional().catch(undefined);
const Qty = z.object({ qty: num, units: z.string().optional() });
const optQty = Qty.optional().catch(undefined);

export const HaePayload = z.object({
  data: z.object({
    metrics: z.array(z.unknown()).optional().catch(undefined),
    workouts: z.array(z.unknown()).optional().catch(undefined),
  }),
});

const Metric = z.object({ name: z.string(), units: z.string().optional(), data: z.array(z.unknown()) });

const Sample = z.object({
  date: z.string(),
  qty: optNum,
  Min: optNum,
  Avg: optNum,
  Max: optNum,
});

const SleepSummary = z.object({
  totalSleep: optNum,
  asleep: optNum,
  core: optNum,
  deep: optNum,
  rem: optNum,
  awake: optNum,
  inBed: optNum,
  sleepStart: z.string().optional(),
  sleepEnd: z.string().optional(),
  inBedStart: z.string().optional(),
  inBedEnd: z.string().optional(),
  source: z.string().optional(),
});

const SleepSegment = z.object({
  startDate: z.string(),
  endDate: z.string(),
  value: z.string(),
  source: z.string().optional(),
});

const Workout = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  start: z.string(),
  end: z.string(),
  duration: optNum,
  location: z.string().optional(),
  activeEnergyBurned: optQty,
  // v1 sends an object, v2 a per-minute series.
  activeEnergy: z
    .union([Qty, z.array(z.object({ qty: num }).catch({ qty: 0 }))])
    .optional()
    .catch(undefined),
  distance: optQty,
  avgHeartRate: optQty,
  maxHeartRate: optQty,
  heartRate: z.object({ avg: optQty, max: optQty }).optional().catch(undefined),
  heartRateData: z
    .array(z.object({ Avg: optNum, Max: optNum, qty: optNum }).catch({}))
    .optional()
    .catch(undefined),
  source: z
    .union([z.string(), z.object({ name: z.string().optional() })])
    .optional()
    .catch(undefined),
});

// Biometrics we keep, aggregated per hour. Everything else Apple Health exports is dropped: the
// coach does not need it and it is health data. `sum` adds samples up, `range` keeps min/avg/max.
const BIOMETRICS: Record<string, { label: string; agg: "sum" | "range"; unit?: string }> = {
  heart_rate: { label: "Heart rate", agg: "range", unit: "bpm" },
  resting_heart_rate: { label: "Resting heart rate", agg: "range", unit: "bpm" },
  walking_heart_rate_average: { label: "Walking heart rate", agg: "range", unit: "bpm" },
  heart_rate_variability: { label: "HRV", agg: "range", unit: "ms" },
  respiratory_rate: { label: "Respiratory rate", agg: "range" },
  blood_oxygen_saturation: { label: "Blood oxygen", agg: "range", unit: "%" },
  vo2_max: { label: "VO2 max", agg: "range" },
  step_count: { label: "Steps", agg: "sum" },
  active_energy: { label: "Active energy", agg: "sum" },
  apple_exercise_time: { label: "Exercise", agg: "sum", unit: "min" },
  apple_stand_time: { label: "Stand time", agg: "sum", unit: "min" },
  flights_climbed: { label: "Flights climbed", agg: "sum" },
  walking_running_distance: { label: "Walking and running distance", agg: "sum" },
};

const sleepMinutesFactor = (units: string | undefined) => (units === "min" ? 1 : units === "s" ? 1 / 60 : 60);

function sleepEvent(
  start: number,
  end: number,
  stages: { total: number; deep?: number; rem?: number; core?: number; awake?: number; in_bed?: number },
  sourceName: string | undefined,
): MappedEvent {
  const opt = (v: number | undefined) => (v === undefined ? undefined : Math.round(v));
  return {
    source: SOURCE,
    type: "sleep",
    start_at: iso(start),
    end_at: iso(end),
    title: `Sleep ${formatMinutes(stages.total)}`,
    // Same keys as the other sleep sources (duration_min, rem_min, deep_min).
    data: Object.fromEntries(
      Object.entries({
        duration_min: Math.round(stages.total),
        deep_min: opt(stages.deep),
        rem_min: opt(stages.rem),
        core_min: opt(stages.core),
        awake_min: opt(stages.awake),
        in_bed_min: opt(stages.in_bed),
        device: sourceName,
      }).filter(([, v]) => v !== undefined),
    ),
    external_id: `hae:sleep:${iso(start).slice(0, 16)}`,
  };
}

function mapSleep(units: string | undefined, samples: unknown[], now: number): MappedEvent[] {
  const f = sleepMinutesFactor(units);
  const out: MappedEvent[] = [];
  const segments: { start: number; end: number; value: string; source?: string }[] = [];

  for (const raw of samples) {
    const seg = SleepSegment.safeParse(raw);
    if (seg.success) {
      const start = parseHaeDate(seg.data.startDate);
      const end = parseHaeDate(seg.data.endDate);
      if (start !== null && end !== null && end > start) {
        segments.push({ start, end, value: seg.data.value.toLowerCase(), source: seg.data.source });
      }
      continue;
    }
    // Summarised: one entry per night, durations in `units` (hours by default).
    const s = SleepSummary.safeParse(raw);
    if (!s.success) continue;
    const d = s.data;
    const start = parseHaeDate(d.sleepStart) ?? parseHaeDate(d.inBedStart);
    const end = parseHaeDate(d.sleepEnd) ?? parseHaeDate(d.inBedEnd);
    if (start === null || end === null || end <= start || end - start > DAY) continue;
    if (end > now - SLEEP_SETTLE_MS) continue;
    const staged = (d.asleep ?? 0) + (d.core ?? 0) + (d.deep ?? 0) + (d.rem ?? 0);
    const total = (d.totalSleep && d.totalSleep > 0 ? d.totalSleep : staged) * f || (end - start) / 60_000;
    const m = (v: number | undefined) => (v === undefined ? undefined : v * f);
    out.push(
      sleepEvent(
        start,
        end,
        { total, deep: m(d.deep), rem: m(d.rem), core: m(d.core), awake: m(d.awake), in_bed: m(d.inBed) },
        d.source,
      ),
    );
  }

  // Unsummarised: segments (Core, Deep, REM, Asleep, Awake, In Bed) grouped into nights.
  segments.sort((a, b) => a.start - b.start);
  const nights: (typeof segments)[] = [];
  for (const seg of segments) {
    const night = nights.at(-1);
    const lastEnd = night ? Math.max(...night.map((x) => x.end)) : 0;
    if (night && seg.start - lastEnd <= NIGHT_GAP_MS) night.push(seg);
    else nights.push([seg]);
  }
  for (const night of nights) {
    const asleep = night.filter((s) => s.value !== "awake" && s.value !== "in bed");
    if (!asleep.length) continue;
    const start = Math.min(...asleep.map((s) => s.start));
    const end = Math.max(...asleep.map((s) => s.end));
    if (end > now - SLEEP_SETTLE_MS || end - start > DAY) continue;
    const sum = (value: string) =>
      night.filter((s) => s.value === value).reduce((acc, s) => acc + (s.end - s.start) / 60_000, 0);
    const total = asleep.reduce((acc, s) => acc + (s.end - s.start) / 60_000, 0);
    const has = (value: string) => night.some((s) => s.value === value);
    out.push(
      sleepEvent(
        start,
        end,
        {
          total,
          deep: has("deep") ? sum("deep") : undefined,
          rem: has("rem") ? sum("rem") : undefined,
          core: has("core") ? sum("core") : undefined,
          awake: has("awake") ? sum("awake") : undefined,
          in_bed: has("in bed") ? sum("in bed") : undefined,
        },
        night[0]?.source,
      ),
    );
  }
  return out;
}

function mapBiometric(
  name: string,
  units: string | undefined,
  samples: unknown[],
  now: number,
): MappedEvent[] {
  const spec = BIOMETRICS[name];
  if (!spec) return [];
  // hour start (ms) -> values
  const buckets = new Map<number, { min: number; max: number; sum: number; avgSum: number; n: number }>();
  for (const raw of samples) {
    const s = Sample.safeParse(raw);
    if (!s.success) continue;
    const t = parseHaeDate(s.data.date);
    const avg = s.data.Avg ?? s.data.qty;
    if (t === null || avg === undefined) continue;
    const hour = Math.floor(t / HOUR) * HOUR;
    // Only complete hours: a later export cannot update a stored hour.
    if (hour + HOUR > now) continue;
    const b = buckets.get(hour) ?? { min: Infinity, max: -Infinity, sum: 0, avgSum: 0, n: 0 };
    b.min = Math.min(b.min, s.data.Min ?? avg);
    b.max = Math.max(b.max, s.data.Max ?? avg);
    b.sum += s.data.qty ?? avg;
    b.avgSum += avg;
    b.n += 1;
    buckets.set(hour, b);
  }

  const unit = spec.unit ?? units ?? "";
  const shown = (v: number) =>
    Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-GB") : String(round(v, 1));
  return [...buckets].map(([hour, b]) => {
    const base = { metric: name, units: unit, samples: b.n };
    const avg = b.avgSum / b.n;
    const range = b.min !== b.max ? `, ${shown(b.min)} to ${shown(b.max)}` : "";
    return {
      source: SOURCE,
      type: "biometric" as const,
      start_at: iso(hour),
      end_at: iso(hour + HOUR),
      title:
        spec.agg === "sum"
          ? `${spec.label} ${shown(b.sum)}${unit && unit !== "count" ? ` ${unit}` : ""}`
          : `${spec.label} ${shown(avg)}${unit ? ` ${unit}` : ""}${range}`,
      data:
        spec.agg === "sum"
          ? { ...base, total: round(b.sum, 1) }
          : { ...base, min: round(b.min, 1), avg: round(avg, 1), max: round(b.max, 1) },
      external_id: `hae:${name}:${iso(hour).slice(0, 13)}`,
    };
  });
}

function mapWorkout(raw: unknown): MappedEvent | null {
  const w = Workout.safeParse(raw);
  if (!w.success) return null;
  const d = w.data;
  const start = parseHaeDate(d.start);
  const end = parseHaeDate(d.end);
  if (start === null || end === null || end < start || end - start > DAY) return null;

  const minutes = (d.duration ?? (end - start) / 1000) / 60;
  const energy =
    d.activeEnergyBurned?.qty ??
    (Array.isArray(d.activeEnergy) ? d.activeEnergy.reduce((a, x) => a + x.qty, 0) : d.activeEnergy?.qty);
  const series = (d.heartRateData ?? [])
    .map((x) => x.Avg ?? x.qty)
    .filter((x): x is number => x !== undefined);
  const avgHr =
    d.avgHeartRate?.qty ??
    d.heartRate?.avg?.qty ??
    (series.length ? series.reduce((a, x) => a + x, 0) / series.length : undefined);
  const maxSeries = (d.heartRateData ?? [])
    .map((x) => x.Max ?? x.qty)
    .filter((x): x is number => x !== undefined);
  const maxHr =
    d.maxHeartRate?.qty ?? d.heartRate?.max?.qty ?? (maxSeries.length ? Math.max(...maxSeries) : undefined);
  const distance = d.distance && d.distance.qty > 0 ? d.distance : undefined;
  const sourceName = typeof d.source === "string" ? d.source : d.source?.name;

  const title = [
    `${d.name} ${formatMinutes(minutes)}`,
    distance ? `${round(distance.qty, 1)} ${distance.units ?? ""}`.trim() : null,
  ]
    .filter(Boolean)
    .join(", ");

  const data = Object.fromEntries(
    Object.entries({
      name: d.name,
      duration_min: round(minutes, 1),
      active_kcal: energy === undefined ? undefined : Math.round(energy),
      distance: distance ? round(distance.qty, 2) : undefined,
      distance_units: distance?.units,
      avg_hr: avgHr === undefined ? undefined : Math.round(avgHr),
      max_hr: maxHr === undefined ? undefined : Math.round(maxHr),
      location: d.location,
      device: sourceName,
    }).filter(([, v]) => v !== undefined),
  );

  return {
    source: SOURCE,
    type: "workout",
    start_at: iso(start),
    end_at: iso(end),
    title,
    data,
    external_id: `hae:workout:${d.id ?? iso(start).slice(0, 19)}`,
  };
}

export interface HaeMapResult {
  events: MappedEvent[];
  // Metric names we do not keep (so the sender's setup can be trimmed).
  skipped_metrics: string[];
}

/** Maps one Health Auto Export body. `now` decides which hours and nights are complete. */
export function mapHealthAutoExport(payload: z.infer<typeof HaePayload>, now: number): HaeMapResult {
  const events: MappedEvent[] = [];
  const skipped = new Set<string>();
  for (const raw of payload.data.metrics ?? []) {
    const m = Metric.safeParse(raw);
    if (!m.success) continue;
    const name = m.data.name.toLowerCase();
    if (name === "sleep_analysis") events.push(...mapSleep(m.data.units, m.data.data, now));
    else if (BIOMETRICS[name]) events.push(...mapBiometric(name, m.data.units, m.data.data, now));
    else skipped.add(name);
  }
  for (const raw of payload.data.workouts ?? []) {
    const e = mapWorkout(raw);
    if (e) events.push(e);
  }
  return { events, skipped_metrics: [...skipped].sort() };
}
