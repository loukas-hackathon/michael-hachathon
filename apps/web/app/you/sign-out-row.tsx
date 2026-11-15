"use client";

import { type ReactNode, useState } from "react";

/**
 * Sign out: a full page load to /auth/signout (never a client navigation, so no screen of the old
 * account stays in the router cache), replacing this entry so Back does not return to it. The label
 * says it is happening at once; an installed iPhone app follows location.replace reliably (#459).
 */
export function SignOutRow({ className, children }: { className: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <a
      href="/auth/signout"
      aria-busy={busy}
      aria-disabled={busy}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        window.location.replace("/auth/signout");
      }}
      className={className}
    >
      {children}
      {busy ? "Signing out" : "Sign out"}
    </a>
  );
}
