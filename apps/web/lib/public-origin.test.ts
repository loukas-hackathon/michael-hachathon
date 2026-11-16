import assert from "node:assert/strict";
import { test } from "node:test";
import { publicOrigin, publicUrl } from "./public-origin";

const req = (url: string, headers: Record<string, string>) => ({ url, headers: new Headers(headers) });

test("behind Railway's proxy the forwarded host wins over the server's own address", () => {
  const r = req("https://localhost:8080/auth/demo", {
    host: "localhost:8080",
    "x-forwarded-host": "web-production-c3b495e1.up.railway.app",
    "x-forwarded-proto": "https",
  });
  assert.equal(publicOrigin(r), "https://web-production-c3b495e1.up.railway.app");
  assert.equal(publicUrl("/today?x=1", r).href, "https://web-production-c3b495e1.up.railway.app/today?x=1");
});

test("local dev keeps its own address", () => {
  assert.equal(
    publicOrigin(req("http://localhost:3000/auth/demo", { host: "localhost:3000" })),
    "http://localhost:3000",
  );
});

test("no host header falls back to request.url", () => {
  assert.equal(publicOrigin(req("http://localhost:3000/x", {})), "http://localhost:3000");
});
