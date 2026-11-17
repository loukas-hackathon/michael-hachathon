import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  type WaitlistAdmin,
  type WaitlistAdminEntry,
  WaitlistCode,
  WaitlistComputer,
  type WaitlistEntry,
  WaitlistJoin,
  WaitlistRole,
  type WaitlistStanding,
  type WaitlistStats,
  waitlistStandings,
} from "@michael/shared";
import { type Context, Hono } from "hono";
import { currentSessionEmail } from "../context";
import { env } from "../env";
import { HttpError, jsonBody, parse } from "../http";
import { rateLimiter } from "../rate-limit";
import { store } from "../store";

// The public waiting list (docs/api.md, Waiting list). Joining and looking up a code need no sign
// in; the full list is for the people in ADMIN_EMAILS only. Position: join order, and each person
// who joins with your code moves you up 5 places (waitlistStandings in @michael/shared).

/** Sign ups per client IP per hour. */
export const JOINS_PER_HOUR = 10;
const joins = rateLimiter(JOINS_PER_HOUR, 60 * 60 * 1000);
/** Tests only: start each test with a fresh allowance. */
export const resetWaitlistLimit = () => joins.reset();

// The web app joins server to server, so the request's own address is the web server's. It passes
// the visitor's address in this header, which counts only next to the API key (the web server
// holds it). Anyone else is counted by the address the proxy in front of us saw.
const CLIENT_IP_HEADER = "x-michael-client-ip";
const apiKey = Buffer.from(env.API_KEY);
const hasApiKey = (c: Context) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7).trim());
  return given.length === apiKey.length && timingSafeEqual(given, apiKey);
};
function clientIp(c: Context): string {
  const forwarded = hasApiKey(c) ? c.req.header(CLIENT_IP_HEADER)?.trim() : undefined;
  return (
    forwarded ||
    c.req.header("x-real-ip")?.trim() ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** 8 url safe characters (48 random bits). */
const newCode = () => randomBytes(6).toString("base64url");

async function standingOf(code: string): Promise<WaitlistStanding | null> {
  const all = await store.listWaitlist();
  const at = waitlistStandings(all).get(code);
  if (!at) return null;
  return { referral_code: code, position: at.position, total: all.length, referrals: at.referrals };
}

export const waitlistPublic = new Hono()
  .post("/waitlist", async (c) => {
    const raw = await jsonBody(c);
    const input = parse(WaitlistJoin, raw);
    // The honeypot: a field people never see. Only a bot fills it in.
    if (input.website?.trim()) throw new HttpError("bad_request", "Validation failed");
    if (!joins.take(clientIp(c))) {
      throw new HttpError("rate_limited", "Too many sign ups from here. Try again in an hour.");
    }
    let entry: WaitlistEntry | null = null;
    let created = false;
    // Already on the list: the same answer as the first time, nothing else about anyone.
    entry = await store.getWaitlistEntry({ email: input.email });
    for (let attempt = 0; !entry && attempt < 3; attempt++) {
      try {
        entry = await store.addWaitlistEntry({
          email: input.email,
          name: input.name,
          role: input.role,
          hours_lost_per_week: input.hours_lost_per_week,
          computer: input.computer,
          phone: input.phone,
          calendar: input.calendar,
          founding_member: input.founding_member,
          referral_code: newCode(),
          referred_by: input.ref ?? null,
          source: input.source?.trim() || null,
        });
        if (entry) created = true;
        // Joined in the same instant by another request: read that one.
        else entry = await store.getWaitlistEntry({ email: input.email });
      } catch (err) {
        // A referral code collision (48 random bits): try a new code.
        if (!(err instanceof HttpError && err.code === "conflict") || attempt === 2) throw err;
      }
    }
    if (!entry) throw new HttpError("internal", "Could not add you to the list");
    const standing = await standingOf(entry.referral_code);
    if (!standing) throw new HttpError("internal", "Could not add you to the list");
    c.header("cache-control", "no-store");
    return c.json(standing, created ? 201 : 200);
  })
  .get("/waitlist/:code", async (c) => {
    const code = WaitlistCode.safeParse(c.req.param("code"));
    const standing = code.success ? await standingOf(code.data) : null;
    if (!standing) throw new HttpError("not_found", "No one on the list has that code");
    c.header("cache-control", "no-store");
    return c.json(standing);
  });

const isAdmin = () => {
  const email = currentSessionEmail();
  return Boolean(email && env.ADMIN_EMAILS.includes(email));
};

export function waitlistStats(entries: WaitlistAdminEntry[], now = Date.now()): WaitlistStats {
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const by_role = Object.fromEntries(WaitlistRole.options.map((r) => [r, 0])) as WaitlistStats["by_role"];
  const by_computer = Object.fromEntries(
    WaitlistComputer.options.map((r) => [r, 0]),
  ) as WaitlistStats["by_computer"];
  for (const e of entries) {
    by_role[e.role]++;
    by_computer[e.computer]++;
  }
  return {
    total: entries.length,
    last_7_days: entries.filter((e) => Date.parse(e.created_at) >= weekAgo).length,
    by_role,
    by_computer,
    founding_members: entries.filter((e) => e.founding_member).length,
    top_referrers: entries
      .filter((e) => e.referrals > 0)
      .sort((a, b) => b.referrals - a.referrals || a.position - b.position)
      .slice(0, 10)
      .map((e) => ({ referral_code: e.referral_code, name: e.name, email: e.email, referrals: e.referrals })),
  };
}

// Behind auth (mounted in v1). Anyone who is not an admin gets the same 404 as a missing route,
// so the list's existence says nothing.
export const waitlistAdmin = new Hono().get("/waitlist", async (c) => {
  if (!isAdmin()) throw new HttpError("not_found", `No route for GET ${c.req.path}`);
  const all = await store.listWaitlist();
  const standings = waitlistStandings(all);
  const entries: WaitlistAdminEntry[] = all
    .map((e) => ({ ...e, ...(standings.get(e.referral_code) ?? { position: all.length, referrals: 0 }) }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const body: WaitlistAdmin = { stats: waitlistStats(entries), entries };
  c.header("cache-control", "no-store");
  return c.json(body);
});
