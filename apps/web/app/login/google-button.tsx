"use client";

import { useEffect, useState } from "react";
import "./google-button.css";

// The official Google "G", unchanged (Google Identity branding guidelines).
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px] shrink-0" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

// supabase-js (about 70 kB gzipped) is only needed for the tap, so it is not in the page's first
// load (#255): it starts loading just after first paint and is ready long before a thumb lands.
const loadSupabase = () => import("@supabase/ssr");

const NOT_SET_UP = "Google sign in is not set up here yet. See the demo week instead.";
const NO_REACH = "I couldn't reach Google. Check your connection and try again.";

export function GoogleButton({ initialError }: { initialError?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  // Coming back from Google with the Back button restores this page from cache: reset the button.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", reset);
    // Shortly after first paint (Safari has no requestIdleCallback).
    const warm = window.setTimeout(() => void loadSupabase().catch(() => {}), 300);
    return () => {
      window.removeEventListener("pageshow", reset);
      window.clearTimeout(warm);
    };
  }, []);

  async function signIn() {
    setBusy(true);
    setError(null);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      setError(NOT_SET_UP);
      setBusy(false);
      return;
    }
    try {
      const { createBrowserClient } = await loadSupabase();
      const supabase = createBrowserClient(url, key);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          // Always show Google's account chooser, so a second account is one tap away.
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
      // Success: the browser is on its way to Google. Keep the loading state until it leaves.
    } catch {
      setError(NO_REACH);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        aria-busy={busy}
        className="g-button press flex h-12 w-full items-center justify-center gap-3 rounded-full px-6 text-body font-semibold"
      >
        {busy ? <span className="g-spinner" aria-hidden="true" /> : <GoogleG />}
        <span>{busy ? "Opening Google" : "Continue with Google"}</span>
      </button>
      <p
        role="alert"
        aria-live="polite"
        className="min-h-[18px] text-balance text-center text-footnote text-danger"
      >
        {error}
      </p>
    </div>
  );
}
