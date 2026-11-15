import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";

// The "@michael/shared" index re-exports every schema, so one value import from it in client code
// ships zod and the whole schema file (about 43 kB gzipped) to that route. Client code uses the
// zod free entries instead (@michael/shared/categories, /connectors, /goal-areas, /sleep, /voice-limits) and
// imports only types from the index. This walks every "use client" file and what it imports.

const WEB = resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".next", "public"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [p] : [];
  });
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(WEB, spec.slice(2)) : resolve(dirname(from), spec);
  for (const p of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")])
    if (existsSync(p) && statSync(p).isFile()) return p;
  return null;
}

const IMPORT = /import\s+(type\s+)?[^"']*?from\s+["']([^"']+)["']/g;

test("client code takes only types from the @michael/shared index", () => {
  const roots = files(WEB).filter((f) => /^["']use client["']/m.test(readFileSync(f, "utf8")));
  const seen = new Set<string>();
  const offenders: string[] = [];
  const walk = (f: string) => {
    if (seen.has(f)) return;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    // Server only modules never reach the browser.
    if (/^import\s+["']server-only["']/m.test(src) || /^["']use server["']/m.test(src)) return;
    for (const [, typeOnly, spec] of src.matchAll(IMPORT)) {
      if (!spec) continue;
      if (spec === "@michael/shared") {
        if (!typeOnly) offenders.push(relative(WEB, f));
      } else if (spec.startsWith(".") || spec.startsWith("@/")) {
        const next = resolveImport(f, spec);
        if (next) walk(next);
      }
    }
  };
  for (const f of roots) walk(f);
  assert.ok(roots.length > 10, "found the client components");
  assert.deepEqual(offenders, []);
});
