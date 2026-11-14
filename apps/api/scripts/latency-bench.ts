// Round trips and latency per API request against a fake Supabase that answers every request
// after LATENCY_MS (Railway US East to Supabase Frankfurt is about 95 ms). Counts every database
// and Auth request the API makes, so changes to round trips can be compared before and after.
//
//   pnpm --filter @michael/api exec tsx scripts/latency-bench.ts
//
// The fake answers reads with no rows, so routes that branch on data may make a few more round
// trips in production; the comparison is like for like.

export {};

const LATENCY_MS = Number(process.env.LATENCY_MS ?? 95);
const USER = "00000000-0000-4000-8000-0000000000b1";
const SUPABASE = "https://fake-project.supabase.co";

Object.assign(process.env, {
  SUPABASE_URL: SUPABASE,
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  API_KEY: "bench-key",
  DEMO_WEEK: process.env.DEMO_WEEK ?? "off",
  SCHEDULER_ENABLED: "false",
  CALENDAR_SYNC_MINUTES: "0",
  NODE_ENV: "test",
});
for (const k of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_MAPS_API_KEY"]) {
  delete process.env[k];
}

// A signed in user's access token, signed like Supabase's asymmetric (ES256) signing keys.
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const jwk = {
  ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
  kid: "bench",
  alg: "ES256",
  use: "sig",
};
const b64 = (v: string | Uint8Array) => Buffer.from(v).toString("base64url");
const header = b64(JSON.stringify({ alg: "ES256", kid: "bench", typ: "JWT" }));
const jwt = await signedToken(3600);

async function signedToken(seconds: number) {
  const payload = b64(
    JSON.stringify({
      sub: USER,
      role: "authenticated",
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + seconds,
    }),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.privateKey,
      Buffer.from(`${header}.${payload}`),
    ),
  );
  return `${header}.${payload}.${b64(signature)}`;
}

const seen: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== SUPABASE) return realFetch(input, init);
  seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.pathname === "/auth/v1/user")
    return json({ id: USER, aud: "authenticated", role: "authenticated" });
  if (url.pathname.endsWith("/jwks.json")) return json({ keys: [jwk] });
  const accept = new Headers(init?.headers).get("accept") ?? "";
  return json(accept.includes("vnd.pgrst.object") ? {} : []);
}) as typeof fetch;

const { app } = await import("../src/app");

const day = new Date().toISOString().slice(0, 10);
const routes = [
  "/v1/goals",
  "/v1/score",
  `/v1/timeline?date=${day}`,
  "/v1/recommendations",
  "/v1/patterns",
  "/v1/instructions",
  "/v1/places",
  "/v1/integrations",
  "/v1/agents",
];

async function measure(label: string, headers: Record<string, string>) {
  console.log(`\n${label}`);
  console.log("| Request | Round trips | Time (ms) |");
  console.log("| --- | ---: | ---: |");
  for (const path of routes) {
    seen.length = 0;
    const start = performance.now();
    const res = await app.request(path, { headers });
    await res.text();
    const ms = performance.now() - start;
    console.log(`| GET ${path.split("?")[0]} (${res.status}) | ${seen.length} | ${ms.toFixed(0)} |`);
  }
}

// First request: cold token (Auth or JWKS), then every route with a warm token.
seen.length = 0;
let start = performance.now();
await (await app.request("/v1/goals", { headers: { authorization: `Bearer ${jwt}` } })).text();
console.log(
  `Cold sign in (first request, GET /v1/goals): ${seen.length} round trips, ${(performance.now() - start).toFixed(0)} ms`,
);
console.log(`  ${seen.join(", ")}`);
// A refreshed access token (supabase-js refreshes hourly) or the 60 s cache running out.
seen.length = 0;
start = performance.now();
const fresh = await signedToken(3500);
await (await app.request("/v1/instructions", { headers: { authorization: `Bearer ${fresh}` } })).text();
console.log(
  `New token for a known user (GET /v1/instructions): ${seen.length} round trips, ${(performance.now() - start).toFixed(0)} ms`,
);
await measure("Signed in user, warm", { authorization: `Bearer ${jwt}` });

if (process.env.DEMO_WEEK === "on") {
  seen.length = 0;
  start = performance.now();
  const demo = {
    authorization: "Bearer bench-key",
    "x-michael-demo-visitor": "11111111-1111-4111-8111-111111111111",
  };
  await (await app.request("/v1/goals", { headers: demo })).text();
  console.log(
    `\nDemo visitor, first request (demo week refresh): ${seen.length} round trips, ${(performance.now() - start).toFixed(0)} ms`,
  );
  await measure("Demo visitor, warm", demo);
}
process.exit(0);
