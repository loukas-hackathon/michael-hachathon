// Zod free (the web app's client components import it): the waiting list's labels and its one rule.
// The schemas are in waitlist.ts. Keys must match the enums there.

/** Places each successful referral moves the inviter up. */
export const WAITLIST_REFERRAL_BOOST = 5;

/** The labels the web app and the CSV use. */
export const WAITLIST_ROLE_LABELS: Record<
  "founder" | "executive" | "employee" | "student" | "other",
  string
> = {
  founder: "Founder",
  executive: "Executive",
  employee: "Employee",
  student: "Student",
  other: "Other",
};
export const WAITLIST_COMPUTER_LABELS: Record<"mac" | "windows" | "linux", string> = {
  mac: "Mac",
  windows: "Windows",
  linux: "Linux",
};
export const WAITLIST_PHONE_LABELS: Record<"iphone" | "android", string> = {
  iphone: "iPhone",
  android: "Android",
};
export const WAITLIST_CALENDAR_LABELS: Record<"google" | "outlook" | "other", string> = {
  google: "Google",
  outlook: "Outlook",
  other: "Other",
};
