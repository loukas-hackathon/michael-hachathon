import type { WaitlistAdminEntry } from "@michael/shared";

// The waiting list as CSV (the admin page's download). RFC 4180: every field quoted, quotes doubled.
// A field that starts with = + - @ gets a leading apostrophe, so a spreadsheet never runs it.

const COLUMNS = [
  "position",
  "created_at",
  "email",
  "name",
  "role",
  "hours_lost_per_week",
  "computer",
  "phone",
  "calendar",
  "founding_member",
  "referral_code",
  "referred_by",
  "referrals",
  "source",
  "invited_at",
] as const satisfies readonly (keyof WaitlistAdminEntry)[];

const cell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export function waitlistCsv(entries: WaitlistAdminEntry[]): string {
  const rows = [COLUMNS.map(cell).join(",")];
  for (const e of entries) rows.push(COLUMNS.map((c) => cell(e[c])).join(","));
  return `${rows.join("\r\n")}\r\n`;
}
