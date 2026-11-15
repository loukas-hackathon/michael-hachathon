"use client";

import { useId, useRef, useState } from "react";
import { Collapse } from "@/components/motion-ui";
import { Thinking } from "@/components/thinking";
import { checkEmailForm, EMAIL_LINES, type EmailLine, type EmailMode } from "@/lib/email-auth";
import { emailAuth } from "./email-actions";

// The one way in (#475, #492): "Continue with email" opens in place into one field set that adapts,
// Create account or Sign in. The server action sets the session cookies, then the page moves on with
// location.replace, so a new account lands on onboarding signed in, and it never leaves the
// installed app.

const LABEL: Record<EmailMode, { idle: string; busy: string; other: string; switchTo: string }> = {
  signup: {
    idle: "Create account",
    busy: "Creating your account",
    other: "Have an account?",
    switchTo: "Sign in",
  },
  signin: { idle: "Sign in", busy: "Signing in", other: "New here?", switchTo: "Create an account" },
};

// 16px or more so iOS never zooms; the field draws its own focus (login.css), the caret does the rest.
const input =
  "h-12 w-full min-w-0 bg-transparent px-4 text-body text-label outline-none placeholder:text-label-2";
const fieldBox = "m-login-field flex items-center rounded-control bg-fill";
const primary =
  "press flex h-12 w-full items-center justify-center rounded-full bg-label px-6 text-body font-semibold text-bg transition-opacity duration-200 disabled:opacity-60";

export function EmailForm({ next, initialError }: { next: string | null; initialError?: string | null }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<EmailMode>("signup");
  const [busy, setBusy] = useState(false);
  // One submission at a time: a ref, so a second tap before the re-render is ignored too.
  const inFlight = useRef(false);
  const [line, setLine] = useState<EmailLine | null>(null);
  const [reveal, setReveal] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function expand() {
    setOpen(true);
    // After the collapse stops being inert, so the field can take focus (and the keyboard opens).
    requestAnimationFrame(() => emailRef.current?.focus({ preventScroll: true }));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const typed = checkEmailForm(mode, email, password);
    if (typed) {
      setLine(typed);
      (typed === "email" ? emailRef : passwordRef).current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setLine(null);
    try {
      const result = await emailAuth({ mode, email, password, next });
      if (result.ok) {
        // Signed in: a full load in this window (so the installed app keeps it), and every server
        // component reads the new session. Keep the pending label until the page goes.
        window.location.replace(result.to);
        return;
      }
      setLine(result.line);
      // Already has an account: the button becomes Sign in, the password stays typed.
      if (result.line === "exists") setMode("signin");
      inFlight.current = false;
      setBusy(false);
    } catch {
      setLine("failed");
      inFlight.current = false;
      setBusy(false);
    }
  }

  const label = LABEL[mode];
  const quiet = line === "unconfirmed";
  // What /auth/callback sent back shows until the form has its own answer.
  const text = line ? EMAIL_LINES[line] : open ? null : (initialError ?? null);

  return (
    <div className="flex flex-col" data-email-open={open ? "" : undefined}>
      <Collapse open={!open}>
        <button
          type="button"
          onClick={expand}
          aria-expanded={open}
          aria-controls={`${id}-form`}
          className={primary}
        >
          Continue with email
        </button>
      </Collapse>
      <Collapse open={open} id={`${id}-form`}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-2" aria-label="Email sign in">
          <div className={fieldBox}>
            <label htmlFor={`${id}-email`} className="sr-only">
              Email
            </label>
            <input
              ref={emailRef}
              id={`${id}-email`}
              name="email"
              type="email"
              inputMode="email"
              autoComplete={mode === "signup" ? "email" : "username"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              placeholder="Email"
              required
              aria-invalid={line === "email" || undefined}
              className={input}
            />
          </div>
          <div className={fieldBox}>
            <label htmlFor={`${id}-password`} className="sr-only">
              Password
            </label>
            <input
              ref={passwordRef}
              id={`${id}-password`}
              name="password"
              type={reveal ? "text" : "password"}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder={mode === "signup" ? "Password, 8 characters or more" : "Password"}
              minLength={mode === "signup" ? 8 : undefined}
              required
              aria-invalid={line === "short" || line === "weak" || line === "wrong" || undefined}
              className={`${input} pr-0`}
            />
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              aria-pressed={reveal}
              aria-controls={`${id}-password`}
              aria-label={reveal ? "Hide password" : "Show password"}
              className="press mr-1 flex h-11 shrink-0 items-center rounded-control px-3 text-subhead text-label-2"
            >
              {reveal ? "Hide" : "Show"}
            </button>
          </div>
          <button type="submit" disabled={busy} aria-busy={busy} className={`${primary} mt-2`}>
            {busy ? <Thinking text={label.busy} className="" /> : label.idle}
          </button>
          <p
            role={quiet ? "status" : "alert"}
            aria-live="polite"
            className={`min-h-[18px] text-balance text-center text-footnote ${quiet ? "text-label-2" : "text-danger"}`}
          >
            {open ? text : null}
          </p>
          <p className="-mt-3 flex items-center justify-center text-footnote text-label-2">
            {label.other}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signup" ? "signin" : "signup");
                setLine(null);
              }}
              disabled={busy}
              className="press flex h-11 items-center rounded-control px-2 font-semibold text-label"
            >
              {label.switchTo}
            </button>
          </p>
          {/* Only where it matters: before a new account, what comes next and who I work for. */}
          <Collapse open={mode === "signup"}>
            <p className="text-balance pt-1 text-center text-footnote text-label-2">
              Next, connect your calendar: that's how I see your week. I work for you and nobody else.
            </p>
          </Collapse>
        </form>
      </Collapse>
      {/* A callback error before the form is open: one line under the button. */}
      {!open && text ? (
        <p role="alert" className="mt-3 text-balance text-center text-footnote text-danger">
          {text}
        </p>
      ) : null}
    </div>
  );
}
