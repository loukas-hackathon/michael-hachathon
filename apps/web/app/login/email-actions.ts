"use server";

import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { E2E_COOKIE } from "@/lib/auth-mode";
import {
  checkEmailForm,
  type EmailAuthResult,
  type EmailMode,
  emailAuthLine,
  failWith,
} from "@/lib/email-auth";
import { API_KEY, API_URL } from "@/lib/mode";
import { NEXT_COOKIE, safeNext } from "@/lib/next-path";
import { authEnabled, DEMO_COOKIE, supabaseServer } from "@/lib/supabase/server";

// Email and password (#475). The whole sign in happens in this request: Supabase answers, the
// session cookies are set on the response, and the form moves on with window.location.replace.
// Nothing leaves the page, so it works inside the installed iPhone app, where Google's redirect
// lands the session in Safari instead of the app.

// Server to server with the API key and no visitor header: the only caller POST /v1/accounts accepts.
async function createAccount(email: string, password: string): Promise<"created" | "exists" | "failed"> {
  const res = await fetch(`${API_URL}/v1/accounts`, {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  if (res.status === 201) return "created";
  if (res.status === 409) return "exists";
  console.error(`[auth] create account failed: ${res.status} ${await res.text().catch(() => "")}`);
  return "failed";
}

type Input = { mode: EmailMode; email: string; password: string; next: string | null };

// The web app has no zod of its own (only @michael/shared's schemas), so the four fields are
// checked by hand: anything off shape is refused before Supabase sees it.
function parse(raw: unknown): Input | null {
  if (!raw || typeof raw !== "object") return null;
  const { mode, email, password, next } = raw as Record<string, unknown>;
  if (mode !== "signin" && mode !== "signup") return null;
  if (typeof email !== "string" || email.length > 320) return null;
  if (typeof password !== "string" || password.length > 200) return null;
  if (next != null && (typeof next !== "string" || next.length > 2000)) return null;
  return { mode, email: email.trim().toLowerCase(), password, next: next ?? null };
}

export async function emailAuth(raw: unknown): Promise<EmailAuthResult> {
  const parsed = parse(raw);
  if (!parsed) return failWith("failed");
  const { mode, email, password } = parsed;
  const typed = checkEmailForm(mode, email, password);
  if (typed) return failWith(typed);

  const store = await cookies();
  const to = safeNext(parsed.next) ?? safeNext(store.get(NEXT_COOKIE)?.value) ?? "/";

  if (process.env.E2E_TEST_AUTH === "on") {
    const result = testAccounts(mode, email, password);
    if (!result.ok) return failWith(result.line);
    store.set(E2E_COOKIE, result.user, { path: "/", sameSite: "lax", httpOnly: true });
  } else {
    if (!authEnabled) return failWith("closed");
    try {
      const auth = (await supabaseServer()).auth;
      if (mode === "signin") {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) return failWith(emailAuthLine(error, mode));
      } else {
        // The API creates the account already confirmed (POST /v1/accounts), so no confirmation
        // email and no Supabase setting stand in the way; then the normal password sign in.
        const created = await createAccount(email, password);
        if (created !== "created") return failWith(created);
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) return failWith(emailAuthLine(error, "signin"));
      }
    } catch (err) {
      console.error(`[auth] email ${mode} failed: ${(err as Error).message}`);
      return failWith("failed");
    }
  }

  // Signed in: the demo visitor and the way back are done with, as after Google (/auth/callback).
  store.delete(DEMO_COOKIE);
  store.delete(NEXT_COOKIE);
  return { ok: true, to };
}

// End to end tests only (E2E_TEST_AUTH=on, never on a deployment): accounts in this process's
// memory, signed in with the same test cookie the other e2e specs use.
const accounts = new Map<string, { hash: string; user: string }>();
const hash = (password: string) => createHash("sha256").update(password).digest("hex");

function testAccounts(
  mode: "signin" | "signup",
  email: string,
  password: string,
): { ok: true; user: string } | { ok: false; line: "wrong" | "exists" } {
  const found = accounts.get(email);
  if (mode === "signup") {
    if (found) return { ok: false, line: "exists" };
    const user = randomUUID();
    accounts.set(email, { hash: hash(password), user });
    return { ok: true, user };
  }
  if (!found || found.hash !== hash(password)) return { ok: false, line: "wrong" };
  return { ok: true, user: found.user };
}
