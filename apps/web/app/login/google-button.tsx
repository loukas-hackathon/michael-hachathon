"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";
import { NEXT_COOKIE } from "@/lib/next-path";

export function GoogleButton({ next }: { next?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    // Survives the Google round trip; /auth/callback reads it once (10 minutes).
    document.cookie = next
      ? `${NEXT_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=600; samesite=lax`
      : `${NEXT_COOKIE}=; path=/; max-age=0`;
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    );
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError("Google sign in is not available yet. Try the demo week.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="press flex h-12 items-center justify-center rounded-group bg-tint text-body font-semibold text-on-tint disabled:opacity-60"
      >
        {busy ? "Opening Google" : "Continue with Google"}
      </button>
      {error ? <p className="text-footnote text-danger">{error}</p> : null}
    </>
  );
}
