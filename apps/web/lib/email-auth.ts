// Email and password sign in (#475): checking what was typed, and turning Supabase Auth's answers
// into one line each in Michael's voice. No "server-only": the login form checks on the device
// first, the server action checks again.

export type EmailMode = "signin" | "signup";

export const MIN_PASSWORD = 8;

/** Every line the email form can show under its button. */
export const EMAIL_LINES = {
  email: "That email doesn't look right. Check it and try again.",
  short: `Passwords need ${MIN_PASSWORD} characters at least. Add a few.`,
  weak: "That password is too easy to guess. Pick a stronger one.",
  wrong: "Wrong email or password. Try again.",
  exists: "You already have an account. Sign in instead.",
  unconfirmed: "Check your inbox. The link there signs you in.",
  closed: "Sign in isn't open yet. See the demo week for now.",
  busy: "Too many tries. Wait a minute, then try again.",
  failed: "I couldn't sign you in. Check your connection and try again.",
  slow: "That took too long on our side. Try again in a moment.",
} as const;

export type EmailLine = keyof typeof EMAIL_LINES;

// Loose on purpose: Supabase has the last word. This only catches typos before a round trip.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The line for what was typed, or null when it is worth sending. */
export function checkEmailForm(mode: EmailMode, email: string, password: string): EmailLine | null {
  if (!EMAIL.test(email.trim())) return "email";
  if (mode === "signup" && password.length < MIN_PASSWORD) return "short";
  if (!password) return "wrong";
  return null;
}

/** What supabase-js puts on an AuthError that we read. */
export type AuthErrorLike = { code?: string | null; message?: string | null; status?: number | null };

/**
 * One line for a Supabase Auth error. Codes first (supabase-js 2.4x sets `code`), the message as a
 * fallback for older servers.
 */
export function emailAuthLine(error: AuthErrorLike, mode: EmailMode): EmailLine {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  if (code === "invalid_credentials" || message.includes("invalid login credentials")) return "wrong";
  if (code === "user_already_exists" || code === "email_exists" || message.includes("already registered"))
    return "exists";
  if (code === "weak_password" || message.includes("password should")) return "weak";
  if (
    code === "email_address_invalid" ||
    message.includes("email address") ||
    message.includes("invalid email")
  )
    return "email";
  if (code === "email_not_confirmed" || message.includes("not confirmed")) return "unconfirmed";
  if (
    code === "email_provider_disabled" ||
    code === "signup_disabled" ||
    message.includes("signups not allowed") ||
    message.includes("provider is not enabled")
  )
    return "closed";
  if (code.startsWith("over_") || error.status === 429) return "busy";
  return mode === "signin" && error.status === 400 ? "wrong" : "failed";
}

/** What the server action answers the form. */
export type EmailAuthResult = { ok: true; to: string } | { ok: false; line: EmailLine; text: string };

export const failWith = (line: EmailLine): EmailAuthResult => ({ ok: false, line, text: EMAIL_LINES[line] });

/** How long the form waits on creating an account, and on signing in, before it moves on. */
export const AUTH_WAIT_MS = 8_000;

/** Resolves to "slow" when `work` has not answered within `ms`. */
export async function withinWait<T>(work: Promise<T>, ms = AUTH_WAIT_MS): Promise<T | "slow"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"slow">((resolve) => {
    timer = setTimeout(() => resolve("slow"), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** What POST /v1/accounts answered: "slow" is a timeout or a 5xx, when the account may exist anyway. */
export type CreateOutcome = "created" | "exists" | "busy" | "failed" | "slow";
/** What the password sign in answered: null is signed in. */
export type SignInOutcome = AuthErrorLike | null | "slow";

/**
 * Creating an account, robust to a slow Supabase (13:56 incident): createUser can time out and still
 * make the account. So on a timeout, a 5xx or "exists", the same email and password try to sign in,
 * and only when that fails too does the form show one line. `isNew` sends the visitor to onboarding.
 */
export async function signUpFlow(deps: {
  createAccount: () => Promise<CreateOutcome>;
  signIn: () => Promise<SignInOutcome>;
}): Promise<{ ok: true; isNew: boolean } | { ok: false; line: EmailLine }> {
  const created = await deps.createAccount();
  if (created === "busy" || created === "failed") return { ok: false, line: created };
  const signedIn = await deps.signIn();
  if (signedIn === null) return { ok: true, isNew: created !== "exists" };
  if (created === "slow" || signedIn === "slow") return { ok: false, line: "slow" };
  if (created === "exists") return { ok: false, line: "exists" };
  return { ok: false, line: emailAuthLine(signedIn, "signin") };
}
