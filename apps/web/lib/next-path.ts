// Where to go after signing in. Only same site paths, so a link can never bounce someone to
// another site. The login page keeps it in a short lived cookie across the Google round trip,
// because Supabase only redirects to exact allow listed URLs.
export const NEXT_COOKIE = "michael_next";

export function safeNext(value: string | null | undefined): string | null {
  if (!value?.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}
