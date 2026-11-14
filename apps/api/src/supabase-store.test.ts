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
function fakePostgrest(tables: Record<string, Row[]>) {
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
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
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

test("listEvents returns every row of the window, oldest first, past any page or old cap", async () => {
  const all = events(21_000); // more than the old 20,000 ceiling, and over 4 days of 3 a minute
  const pg = fakePostgrest({ events: all });
  const store = new SupabaseStore("http://fake.local", "key", { fetch: pg.fetch });
  const from = new Date(MONDAY).toISOString();
  const to = new Date(MONDAY + 7 * 24 * 3600_000).toISOString();

  const got = await runAsUser(USER, () => store.listEvents({ from, to }));

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

test("listEvents keeps the window, the filters and a page that ends exactly at the cap", async () => {
  const all = events(3000);
  const pg = fakePostgrest({ events: all });
  const store = new SupabaseStore("http://fake.local", "key", { fetch: pg.fetch });
  // Minutes 100 to 199: rows 300 to 599 start there, and rows 297 to 299 end at minute 100.
  const from = new Date(MONDAY + 100 * 60_000).toISOString();
  const to = new Date(MONDAY + 199 * 60_000).toISOString();
  const got = await runAsUser(USER, () =>
    store.listEvents({ from, to, source: ["macos_usage"], type: ["app_usage"] }),
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
    store2.listEvents({
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
