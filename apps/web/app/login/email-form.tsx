"use client";

import { useId, useRef, useState } from "react";
import { Collapse } from "@/components/motion-ui";
import { checkEmailForm, EMAIL_LINES, type EmailLine, type EmailMode } from "@/lib/email-auth";
import { emailAuth } from "./email-actions";

// "Continue with email" (#475): opens in place into email, password and one button. The server
// action sets the session cookies, then the page moves on with location.replace, so it never leaves
// the installed app. The only way in since Google sign in was removed (#475).

const LABEL: Record<EmailMode, { idle: string; busy: string; other: string; switchTo: string }> = {
  signup: {
    idle: "Create account",
    busy: "Creating account",
    other: "Have an account?",
    switchTo: "Sign in",
  },
  signin: { idle: "Sign in", busy: "Signing in", other: "New here?", switchTo: "Create an account" },
};

const field =
  "h-12 w-full min-w-0 bg-transparent px-4 text-body text-label outline-none placeholder:text-label-2 focus-visible:outline-none";

export function EmailForm({ next }: { next: string | null }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<EmailMode>("signup");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<EmailLine | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function expand() {
    setOpen(true);
    // After the collapse stops being inert, so the field can take focus (and the keyboard opens).
    requestAnimationFrame(() => emailRef.current?.focus({ preventScroll: true }));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const typed = checkEmailForm(mode, email, password);
    if (typed) {
      setLine(typed);
      (typed === "email" ? emailRef : passwordRef).current?.focus();
      return;
    }
    setBusy(true);
    setLine(null);
    try {
      const result = await emailAuth({ mode, email, password, next });
      if (result.ok) {
        // Signed in: a full load, so every server component reads the new session. Keep the
        // pending label until the page goes.
        window.location.replace(result.to);
        return;
      }
      setLine(result.line);
      // Already has an account: the button becomes Sign in, the password stays typed.
      if (result.line === "exists") setMode("signin");
      setBusy(false);
    } catch {
      setLine("failed");
      setBusy(false);
    }
  }

  const label = LABEL[mode];
  const quiet = line === "unconfirmed";

  return (
    <div className="flex flex-col">
      <Collapse open={!open}>
        <button
          type="button"
          onClick={expand}
          aria-expanded={open}
          aria-controls={`${id}-form`}
          className="press flex h-12 w-full items-center justify-center rounded-full bg-label px-6 text-body font-semibold text-bg"
        >
          Continue with email
        </button>
      </Collapse>
      <Collapse open={open} id={`${id}-form`}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3" aria-label="Email sign in">
          <div className="overflow-hidden rounded-group bg-fill">
            <label htmlFor={`${id}-email`} className="sr-only">
              Email
            </label>
            <input
              ref={emailRef}
              id={`${id}-email`}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Email"
              required
              className={field}
            />
            <div className="ml-4 h-[0.5px] bg-separator" />
            <label htmlFor={`${id}-password`} className="sr-only">
              Password
            </label>
            <input
              ref={passwordRef}
              id={`${id}-password`}
              name="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder={mode === "signup" ? "Password, 8 characters or more" : "Password"}
              minLength={mode === "signup" ? 8 : undefined}
              required
              className={field}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className="press flex h-12 w-full items-center justify-center rounded-full bg-label px-6 text-body font-semibold text-bg transition-opacity duration-200 disabled:opacity-60"
          >
            {busy ? label.busy : label.idle}
          </button>
          <p
            role={quiet ? "status" : "alert"}
            aria-live="polite"
            className={`min-h-[18px] text-balance text-center text-footnote ${quiet ? "text-label-2" : "text-danger"}`}
          >
            {line ? EMAIL_LINES[line] : null}
          </p>
          <p className="-mt-2 flex items-center justify-center text-footnote text-label-2">
            {label.other}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signup" ? "signin" : "signup");
                setLine(null);
              }}
              disabled={busy}
              className="press flex h-11 items-center px-2 font-semibold text-tint-text"
            >
              {label.switchTo}
            </button>
          </p>
        </form>
      </Collapse>
    </div>
  );
}
