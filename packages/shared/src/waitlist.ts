import { z } from "zod";
import { WAITLIST_REFERRAL_BOOST } from "./waitlist-labels";

// ---------- the public waiting list (docs/api.md, Waiting list) ----------
// People who want Michael before they have an account. Joining is public; the full list is for
// admins only (ADMIN_EMAILS on the API).

export const WaitlistRole = z.enum(["founder", "executive", "employee", "student", "other"]);
export type WaitlistRole = z.infer<typeof WaitlistRole>;
export const WaitlistComputer = z.enum(["mac", "windows", "linux"]);
export type WaitlistComputer = z.infer<typeof WaitlistComputer>;
export const WaitlistPhone = z.enum(["iphone", "android"]);
export type WaitlistPhone = z.infer<typeof WaitlistPhone>;
export const WaitlistCalendar = z.enum(["google", "outlook", "other"]);
export type WaitlistCalendar = z.infer<typeof WaitlistCalendar>;

/** Short, url safe: what an invite link carries (`/join?ref=CODE`). */
export const WaitlistCode = z.string().regex(/^[A-Za-z0-9_-]{4,32}$/);

export const WaitlistJoin = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  // Optional: left out or blank, the API keeps a display name made from the email.
  name: z.string().trim().max(120).optional().nullable(),
  role: WaitlistRole,
  // Their own guess of the hours they lose a week.
  hours_lost_per_week: z.coerce.number().int().min(0).max(80),
  computer: WaitlistComputer,
  phone: WaitlistPhone,
  calendar: WaitlistCalendar,
  // Interest in prepaying €15 a month for life. No payment is taken.
  founding_member: z.boolean().default(false),
  // The inviter's referral code (`?ref=`); ignored when it matches nobody.
  ref: WaitlistCode.optional().nullable(),
  // utm_source or the referrer.
  source: z.string().trim().max(200).optional().nullable(),
  // Honeypot: a field people never see. Anything in it and the sign up is quietly dropped.
  website: z.string().max(500).optional(),
});
export type WaitlistJoin = z.input<typeof WaitlistJoin>;

/** Where one code stands. The only thing the public endpoints return: no email, no name. */
export const WaitlistStanding = z.object({
  referral_code: WaitlistCode,
  position: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  referrals: z.number().int().nonnegative(),
  // What they told us when they joined, echoed on their own page: the hours they lose a week and
  // whether they would prepay. Only ever their own, never a name or an email.
  hours_lost_per_week: z.number().int().nonnegative(),
  founding_member: z.boolean(),
});
export type WaitlistStanding = z.infer<typeof WaitlistStanding>;

/** GET /v1/waitlist/total: how many are waiting, nothing else (public). */
export const WaitlistTotal = z.object({ total: z.number().int().nonnegative() });
export type WaitlistTotal = z.infer<typeof WaitlistTotal>;

/** PATCH /v1/waitlist/:code: what the holder of a code may change after joining. */
export const WaitlistUpdate = z.object({
  founding_member: z.boolean(),
});
export type WaitlistUpdate = z.infer<typeof WaitlistUpdate>;

/** A display name from an email when none was given: "ada.lovelace@x.com" is "Ada Lovelace". */
export function nameFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").replace(/\+.*$/, "");
  const words = local
    .split(/[._-]+/)
    .filter((w) => /[a-z]/i.test(w))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return (words.join(" ") || local || "Friend").slice(0, 120);
}

export const WaitlistEntry = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: WaitlistRole,
  hours_lost_per_week: z.number().int(),
  computer: WaitlistComputer,
  phone: WaitlistPhone,
  calendar: WaitlistCalendar,
  founding_member: z.boolean(),
  referral_code: WaitlistCode,
  referred_by: z.string().nullable(),
  source: z.string().nullable(),
  created_at: z.string(),
  invited_at: z.string().nullable(),
});
export type WaitlistEntry = z.infer<typeof WaitlistEntry>;

export const WaitlistAdminEntry = WaitlistEntry.extend({
  position: z.number().int().positive(),
  referrals: z.number().int().nonnegative(),
});
export type WaitlistAdminEntry = z.infer<typeof WaitlistAdminEntry>;

export const WaitlistStats = z.object({
  total: z.number().int().nonnegative(),
  last_7_days: z.number().int().nonnegative(),
  by_role: z.record(WaitlistRole, z.number().int().nonnegative()),
  by_computer: z.record(WaitlistComputer, z.number().int().nonnegative()),
  founding_members: z.number().int().nonnegative(),
  // Up to 10, most referrals first.
  top_referrers: z.array(
    z.object({
      referral_code: WaitlistCode,
      name: z.string(),
      email: z.string(),
      referrals: z.number().int(),
    }),
  ),
});
export type WaitlistStats = z.infer<typeof WaitlistStats>;

export const WaitlistAdmin = z.object({
  stats: WaitlistStats,
  // Newest first.
  entries: z.array(WaitlistAdminEntry),
});
export type WaitlistAdmin = z.infer<typeof WaitlistAdmin>;

type Ranked = Pick<WaitlistEntry, "id" | "referral_code" | "referred_by" | "created_at">;

/**
 * Positions on the list. Rule: everyone starts at their place by join time (created_at, then id),
 * and each person who joined with their code moves them up WAITLIST_REFERRAL_BOOST places. Sorted
 * by `place - 5 * referrals`; on a tie the one with more referrals goes first (so 5 places are
 * really 5), then whoever joined first. Position 1 is the front.
 */
export function waitlistStandings<T extends Ranked>(
  entries: readonly T[],
): Map<string, { position: number; referrals: number }> {
  const byTime = [...entries].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const referrals = new Map<string, number>();
  for (const e of entries) {
    if (e.referred_by && e.referred_by !== e.referral_code) {
      referrals.set(e.referred_by, (referrals.get(e.referred_by) ?? 0) + 1);
    }
  }
  const scored = byTime.map((e, i) => {
    const r = referrals.get(e.referral_code) ?? 0;
    return { code: e.referral_code, order: i, score: i + 1 - WAITLIST_REFERRAL_BOOST * r, referrals: r };
  });
  scored.sort((a, b) => a.score - b.score || b.referrals - a.referrals || a.order - b.order);
  const out = new Map<string, { position: number; referrals: number }>();
  scored.forEach((s, i) => {
    out.set(s.code, { position: i + 1, referrals: s.referrals });
  });
  return out;
}
