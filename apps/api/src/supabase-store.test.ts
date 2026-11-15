import assert from "node:assert/strict";
import { test } from "node:test";
import { runAsUser } from "./context";
import { SupabaseStore } from "./supabase-store";

// The real supabase-js client against a fake PostgREST that, like the real one, never returns more
// than 1000 rows per response. Proves listEvents and the other lists have no ceiling (#127).

const USER = "00000000-0000-4000-8000-000000000001";
const MAX_ROWS = 1000;

type Row = Record<string, unknown> & { id: string; start_at: string };

/** A fake PostgREST for `events` (keyset pages) and `recommendations` (offset pages). */
function fakePostgrest(
  tables: Record<string, Row[]>,
  opts: { rpc?: boolean; rpcFail?: "500" | "throw" } = {},
) {
  const requests: URL[] = [];
  const ms = new Map<string, number>();
  const t = (v: string): number => {
    let n = ms.get(v);
    if (n === undefined) {
      n = Date.parse(v);
      ms.set(v, n);
    }
    return n;
  };
  // Sorted once as the database's index would be, so each request only filters.
  const byStart = (a: Row, b: Row) => t(a.start_at) - t(b.start_at) || a.id.localeCompare(b.id);
  if (tables.events) tables.events = [...tables.events].sort(byStart);
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    if (url.pathname.includes("/rpc/")) {
      if (opts.rpcFail === "throw") throw new TypeError("fetch failed");
      if (opts.rpcFail === "500") {
        return new Response(
          JSON.stringify({ code: "57014", message: "canceling statement due to timeout" }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        );
      }
      // events_window (#298) as Postgres answers it: one json value, no row cap. Without `rpc`
      // the function is missing, as before its migration ran (PostgREST's PGRST202).
      if (!opts.rpc || !url.pathname.endsWith("/events_window")) {
        return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      const a = JSON.parse(String(init?.body ?? "{}"));
      const [from, to] = [Date.parse(a.p_from), Date.parse(a.p_to)];
      const rows = (tables.events ?? []).filter((r) => {
        const start = t(r.start_at);
        const end = r.end_at ? t(r.end_at as string) : start;
        return (
          r.user_id === a.p_user_id &&
          start <= to &&
          end >= from &&
          (!a.p_sources || a.p_sources.includes(r.source)) &&
          (!a.p_types || a.p_types.includes(r.type))
        );
      });
      return new Response(JSON.stringify(rows.map(({ user_id: _u, ...r }) => r)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const table = url.pathname.split("/").pop() as string;
    const p = url.searchParams;
    let rows = (tables[table] ?? []).filter((r) => r.user_id === USER);

    if (table === "events") {
      const to = Date.parse((p.get("start_at") ?? "").replace(/^lte\./, ""));
      const or = p.get("or") ?? "";
      const from = Date.parse(/end_at\.gte\."([^"]+)"/.exec(or)?.[1] ?? "");
      assert.ok(Number.isFinite(to) && Number.isFinite(from), `window in ${url.search}`);
      rows = rows.filter((r) => {
        const start = t(r.start_at);
        const end = r.end_at ? t(r.end_at as string) : null;
        return start <= to && (end !== null ? end >= from : start >= from);
      });
      // source=in.(a,b) and type=in.(a,b), as supabase-js sends .in().
      for (const col of ["source", "type"]) {
        const inList = /^in\.\((.*)\)$/.exec(p.get(col) ?? "")?.[1];
        if (inList !== undefined) {
          const allowed = new Set(inList.split(",").map((v) => v.replace(/^"|"$/g, "")));
          rows = rows.filter((r) => allowed.has(String(r[col])));
        }
      }
      const cursor = /start_at\.gt\."([^"]+)",and\(start_at\.eq\."[^"]+",id\.gt\.([^)]+)\)/.exec(or);
      if (cursor) {
        const [at, id] = [Date.parse(cursor[1] as string), cursor[2] as string];
        rows = rows.filter((r) => t(r.start_at) > at || (t(r.start_at) === at && r.id > id));
      }
      assert.equal(p.get("order"), "start_at.asc,id.asc");
      // Only the columns asked for: never user_id.
      const columns = (p.get("select") ?? "").split(",").map((c) => c.trim());
      assert.ok(!columns.includes("user_id") && !columns.includes("*"));
      rows = rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])) as Row);
    } else {
      assert.equal(p.get("order"), "created_at.desc,id.desc");
      rows.sort(
        (a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id.localeCompare(a.id),
      );
    }

    const offset = Number(p.get("offset") ?? 0);
    const limit = Math.min(Number(p.get("limit") ?? MAX_ROWS), MAX_ROWS);
    const body = rows.slice(offset, offset + limit);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const pad = (n: number) => n.toString(16).padStart(12, "0");
const MONDAY = Date.parse("2026-11-09T00:00:00Z");

/** `n` one minute app events from Monday 00:00, many sharing a start so the id tiebreak matters. */
function events(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => {
    // Three events per minute start at the same instant: pages must not split or repeat them.
    const start = MONDAY + Math.floor(i / 3) * 60_000;
    return {
      id: `00000000-0000-4000-8000-${pad(n - i)}`, // ids run against time, so id order alone is wrong
      user_id: USER,
      source: "macos_usage",
      type: "app_usage",
      start_at: new Date(start).toISOString().replace("Z", "+00:00"),
      end_at: new Date(start + 60_000).toISOString().replace("Z", "+00:00"),
      title: `App ${i}`,
      data: {},
      external_id: null,
      created_at: new Date(start).toISOString(),
    };
  });
}

test("the paged listEvents returns every row of the window, oldest first, past any page or old cap", async () => {
  const all = events(21_000); // more than the old 20,000 ceiling, and over 4 days of 3 a minute
  const pg = fakePostgrest({ events: all });
  const store = new SupabaseStore("http://fake.local", "key", { fetch: pg.fetch });
  const from = new Date(MONDAY).toISOString();
  const to = new Date(MONDAY + 7 * 24 * 3600_000).toISOString();

  const got = await runAsUser(USER, () => store.listEventsPaged({ from, to }));

  assert.equal(got.length, all.length);
  assert.equal(new Set(got.map((e) => e.id)).size, all.length, "no row twice");
  for (let i = 1; i < got.length; i++) {
    assert.ok(
      Date.parse(got[i - 1]?.start_at ?? "") <= Date.parse(got[i]?.start_at ?? ""),
      `in order at ${i}`,
    );
  }
  // The newest row is there: the old reader dropped the newest hours.
  assert.ok(got.slice(-3).some((e) => e.title === "App 20999"));
  assert.equal(pg.requests.length, 22, "21 full pages and one short one");
  assert.ok(
    pg.requests.every((u) => !u.searchParams.has("offset")),
    "keyset paging, no OFFSET",
  );
});

test("the paged listEvents keeps the window, the filters and a page that ends exactly at the cap", async () => {
  const all = events(3000);
  const pg = fakePostgrest({ events: all });
  const store = new SupabaseStore("http://fake.local", "key", { fetch: pg.fetch });
  // Minutes 100 to 199: rows 300 to 599 start there, and rows 297 to 299 end at minute 100.
  const from = new Date(MONDAY + 100 * 60_000).toISOString();
  const to = new Date(MONDAY + 199 * 60_000).toISOString();
  const got = await runAsUser(USER, () =>
    store.listEventsPaged({ from, to, source: ["macos_usage"], type: ["app_usage"] }),
  );
  assert.equal(got.length, 303);
  assert.deepEqual(
    got
      .slice(0, 3)
      .map((e) => e.title)
      .sort(),
    ["App 297", "App 298", "App 299"],
  );
  assert.ok(pg.requests[0]?.searchParams.get("source") === "in.(macos_usage)");

  // Exactly 1000 rows: one full page, then an empty one ends the read.
  const exact = fakePostgrest({ events: events(1000) });
  const store2 = new SupabaseStore("http://fake.local", "key", { fetch: exact.fetch });
  const all1000 = await runAsUser(USER, () =>
    store2.listEventsPaged({
      from: new Date(MONDAY).toISOString(),
      to: new Date(MONDAY + 86_400_000).toISOString(),
    }),
  );
  assert.equal(all1000.length, 1000);
  assert.equal(exact.requests.length, 2);
});

test("listRecommendations pages past PostgREST's 1000 rows", async () => {
  const recs: Row[] = Array.from({ length: 2500 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${pad(i)}`,
    user_id: USER,
    analysis_run_id: null,
    goal_id: null,
    title: `Rec ${i}`,
    rationale: "",
    action: null,
    evidence: [],
    status: "proposed",
    executed_at: null,
    undone_at: null,
    source: "analysis",
    start_at: "",
    created_at: new Date(MONDAY + i * 60_000).toISOString(),
    updated_at: new Date(MONDAY + i * 60_000).toISOString(),
  }));
  const pg = fakePostgrest({ recommendations: recs });
  const store = new SupabaseStore("http://fake.local", "key", { fetch: pg.fetch });
  const got = await runAsUser(USER, () => store.listRecommendations());
  assert.equal(got.length, 2500);
  assert.equal(got[0]?.title, "Rec 2499", "newest first");
  assert.equal(pg.requests.length, 3);
});

test("listEvents reads a window up to three weeks in one round trip with events_window (#298)", async () => {
  const all = events(3000);
  const pg = fakePostgrest({ events: all }, { rpc: true });
  const store = new SupabaseStore("http://fake.local", "key", { fetch: pg.fetch });
  const from = new Date(MONDAY + 100 * 60_000).toISOString();
  const to = new Date(MONDAY + 199 * 60_000).toISOString();
  const got = await runAsUser(USER, () =>
    store.listEvents({ from, to, source: ["macos_usage"], type: ["app_usage"] }),
  );
  assert.equal(got.length, 303, "the same rows as the paged read");
  assert.equal(pg.requests.length, 1, "one round trip");
  assert.ok(pg.requests[0]?.pathname.endsWith("/rpc/events_window"));
  assert.ok(
    got.every((e) => e.start_at.endsWith("Z")),
    "canonical ISO times",
  );

  // A whole busy week is still one round trip.
  const week = await runAsUser(USER, () =>
    store.listEvents({
      from: new Date(MONDAY).toISOString(),
      to: new Date(MONDAY + 7 * 86_400_000).toISOString(),
    }),
  );
  assert.equal(week.length, 3000);
  assert.equal(pg.requests.length, 2);
});

test("listEvents falls back to pages when events_window is missing, and for long windows", async () => {
  const all = events(2500);
  const missing = fakePostgrest({ events: all });
  const store = new SupabaseStore("http://fake.local", "key", { fetch: missing.fetch });
  const from = new Date(MONDAY).toISOString();
  const to = new Date(MONDAY + 86_400_000).toISOString();
  const errors = console.error;
  console.error = () => {};
  try {
    const got = await runAsUser(USER, () => store.listEvents({ from, to }));
    assert.equal(got.length, 2500);
    // The failed call, then three pages.
    assert.equal(missing.requests.length, 4);
    // Within the next minute the function is not tried again.
    await runAsUser(USER, () => store.listEvents({ from, to }));
    assert.equal(missing.requests.length, 7);
    assert.ok(missing.requests.slice(4).every((u) => !u.pathname.includes("/rpc/")));
  } finally {
    console.error = errors;
  }

  // Longer than three weeks: pages, never the function.
  const long = fakePostgrest({ events: all }, { rpc: true });
  const store2 = new SupabaseStore("http://fake.local", "key", { fetch: long.fetch });
  const got = await runAsUser(USER, () =>
    store2.listEvents({ from, to: new Date(MONDAY + 30 * 86_400_000).toISOString() }),
  );
  assert.equal(got.length, 2500);
  assert.ok(long.requests.every((u) => !u.pathname.includes("/rpc/")));
});

/** Edge cases around a window: bounds touched exactly, crossing, outside, offsets and microseconds. */
function edgeEvents(from: number, to: number): Row[] {
  const at = (ms: number, offset = "+00:00", micro = "") => {
    // The same instant written with another UTC offset, as Postgres or a client might send it.
    const [h, m] = offset.slice(1).split(":").map(Number) as [number, number];
    const shift = (offset[0] === "-" ? -1 : 1) * (h * 60 + m) * 60_000;
    const local = new Date(ms + shift).toISOString().replace("Z", "");
    return `${micro ? local.replace(/\.\d{3}$/, `.${micro}`) : local}${offset}`;
  };
  const minute = 60_000;
  const rows: [string, string | null][] = [
    [at(from), null], // 0 instant exactly at from: in
    [at(to), null], // 1 instant exactly at to: in
    [at(to + 1), null], // 2 instant just after to: out
    [at(from - 1), null], // 3 instant just before from: out
    [at(from - 30 * minute), at(from)], // 4 ends exactly at from: in
    [at(from - 30 * minute), at(from - 1)], // 5 ends just before from: out
    [at(from - 60 * minute), at(to + 60 * minute)], // 6 spans the whole window: in
    [at(to), at(to + 30 * minute)], // 7 starts exactly at to: in
    [at(from + 5 * minute, "+03:00"), at(from + 9 * minute, "+03:00")], // 8 another offset: in
    [at(from - 5 * minute, "-05:00"), at(from - minute, "-05:00")], // 9 negative offset, before: out
    [at(from + 7 * minute, "+00:00", "123456"), null], // 10 microseconds: in
    [at(from + 7 * minute, "+00:00", "123457"), null], // 11 a microsecond later: in
    [at(to - minute), at(to - minute + 1)], // 12 short, near the end: in
  ];
  const out: Row[] = rows.map(([start_at, end_at], i) => ({
    id: `00000000-0000-4000-8000-${pad(1000 - i)}`,
    user_id: USER,
    source: i % 2 ? "macos_usage" : "google_calendar",
    type: i % 2 ? "app_usage" : "calendar_event",
    start_at,
    end_at,
    title: `Edge ${i}`,
    data: { i },
    external_id: i % 3 ? null : `x-${i}`,
    created_at: at(from),
  }));
  // Three sharing one start, so the id tiebreak decides the order.
  for (const k of [0, 1, 2]) {
    out.push({ ...(out[8] as Row), id: `00000000-0000-4000-8000-${pad(50 - k)}`, title: `Tie ${k}` });
  }
  // Another user's event inside the window: never returned.
  out.push({
    ...(out[0] as Row),
    id: `00000000-0000-4000-8000-${pad(1)}`,
    user_id: "00000000-0000-4000-8000-000000000002",
    title: "Other user",
  });
  return out;
}

test("events_window and the paged read return identical events: order, fields, bounds, offsets", async () => {
  const from = MONDAY + 9 * 3600_000;
  const to = MONDAY + 17 * 3600_000;
  const rows = [...edgeEvents(from, to), ...events(2500)];
  const viaRpc = fakePostgrest({ events: rows }, { rpc: true });
  const viaPages = fakePostgrest({ events: rows });
  const rpcStore = new SupabaseStore("http://fake.local", "key", { fetch: viaRpc.fetch });
  const pagedStore = new SupabaseStore("http://fake.local", "key", { fetch: viaPages.fetch });

  // The window written in UTC and in Athens time (+02:00 in November) must mean the same instants.
  const athens = (ms: number) => new Date(ms + 2 * 3600_000).toISOString().replace("Z", "+02:00");
  const utc = (ms: number) => new Date(ms).toISOString();
  const filters = [
    { from: utc(from), to: utc(to) },
    { from: athens(from), to: athens(to) },
    { from: utc(from), to: utc(to), source: ["google_calendar" as const] },
    { from: utc(from), to: utc(to), type: ["app_usage" as const] },
    { from: utc(MONDAY), to: utc(MONDAY + 7 * 86_400_000) },
  ];
  for (const f of filters) {
    const a = await runAsUser(USER, () => rpcStore.listEvents(f));
    const b = await runAsUser(USER, () => pagedStore.listEventsPaged(f));
    assert.ok(a.length > 0, `rows for ${JSON.stringify(f)}`);
    assert.deepEqual(a, b, `identical for ${JSON.stringify(f)}`);
  }
  assert.ok(
    viaRpc.requests.every((u) => u.pathname.endsWith("/rpc/events_window")),
    "only the function",
  );
  // The edges land where they should.
  const day = await runAsUser(USER, () => rpcStore.listEvents({ from: utc(from), to: utc(to) }));
  const titles = new Set(day.map((e) => e.title));
  for (const i of [0, 1, 4, 6, 7, 8, 10, 11, 12]) assert.ok(titles.has(`Edge ${i}`), `Edge ${i} in`);
  for (const i of [2, 3, 5, 9]) assert.ok(!titles.has(`Edge ${i}`), `Edge ${i} out`);
  assert.ok(!titles.has("Other user"));
  // Microsecond order is Postgres' own (same ORDER BY in both paths); the fake only has milliseconds.
});

for (const mode of ["500", "throw"] as const) {
  test(`listEvents falls back to the paged read with identical results when events_window fails (${mode})`, async () => {
    const from = MONDAY + 9 * 3600_000;
    const to = MONDAY + 17 * 3600_000;
    const rows = [...edgeEvents(from, to), ...events(2500)];
    const failing = fakePostgrest({ events: rows }, { rpc: true, rpcFail: mode });
    const working = fakePostgrest({ events: rows }, { rpc: true });
    const failStore = new SupabaseStore("http://fake.local", "key", { fetch: failing.fetch });
    const okStore = new SupabaseStore("http://fake.local", "key", { fetch: working.fetch });
    const logged: unknown[][] = [];
    const errors = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      for (const f of [
        { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
        { from: new Date(MONDAY).toISOString(), to: new Date(MONDAY + 7 * 86_400_000).toISOString() },
      ]) {
        const fallback = await runAsUser(USER, () => failStore.listEvents(f));
        const direct = await runAsUser(USER, () => okStore.listEvents(f));
        assert.ok(fallback.length > 0);
        assert.deepEqual(fallback, direct, "the fallback gives the same events");
      }
      assert.equal(logged.length, 1, "logged once");
      assert.equal(
        failing.requests.filter((u) => u.pathname.includes("/rpc/")).length,
        1,
        "not retried within the minute",
      );
    } finally {
      console.error = errors;
    }
  });
}

test("lastEventAtBySource falls back to one query per source when its function fails", async () => {
  const errors = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    for (const mode of ["missing", "throw"] as const) {
      const requests: URL[] = [];
      const fetch = (async (input: string | URL | Request) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        requests.push(url);
        if (url.pathname.includes("/rpc/")) {
          if (mode === "throw") throw new TypeError("fetch failed");
          return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        const source = url.searchParams.get("source");
        const body = source === "eq.google_calendar" ? [{ created_at: "2026-11-14T10:00:00.5+02:00" }] : [];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof globalThis.fetch;
      const store = new SupabaseStore("http://fake.local", "key", { fetch });
      const got = await runAsUser(USER, () => store.lastEventAtBySource());
      assert.deepEqual(got, { google_calendar: "2026-11-14T08:00:00.500Z" });
      assert.equal(requests.filter((u) => u.pathname.includes("/rpc/")).length, 1);
    }
    assert.equal(logged.length, 2, "once per store");
  } finally {
    console.error = errors;
  }
});
