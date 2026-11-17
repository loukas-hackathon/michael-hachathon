import { currentAuthMethod, currentSessionEmail } from "./context";
import { env } from "./env";
import { store } from "./store";

// Admins: the founders. A caller is an admin when they are signed in (a Supabase session, not the
// API key, a device key, an agent or a demo visitor) and their account's email is in ADMIN_EMAILS
// (comma separated, any case). Unset or empty means nobody. Admin routes answer 404 to everyone
// else, so they do not show they exist.

/** The admin emails, lower case. Read on every call, so tests and a restart pick changes up. */
export const adminEmails = (): Set<string> =>
  new Set(
    env.ADMIN_EMAILS.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

/** True when this email is an admin's (pure: for callers that already know the email). */
export const isAdminEmail = (email: string | null | undefined): boolean =>
  Boolean(email) && adminEmails().has((email as string).trim().toLowerCase());

/** True when the current caller is an admin. Never throws. */
export async function isAdmin(): Promise<boolean> {
  if (currentAuthMethod() !== "session" || adminEmails().size === 0) return false;
  // The session's own email when the sign in carried it (auth.ts); else the account's, from Supabase.
  if (isAdminEmail(currentSessionEmail())) return true;
  try {
    return isAdminEmail(await store.currentAccountEmail());
  } catch {
    return false;
  }
}
