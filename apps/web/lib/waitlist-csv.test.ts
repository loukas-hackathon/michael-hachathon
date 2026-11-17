import assert from "node:assert/strict";
import { test } from "node:test";
import type { WaitlistAdminEntry } from "@michael/shared";
import { waitlistCsv } from "./waitlist-csv";

const entry: WaitlistAdminEntry = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ana@example.com",
  name: 'Ana "the founder", Jr',
  role: "founder",
  hours_lost_per_week: 6,
  computer: "mac",
  phone: "iphone",
  calendar: "google",
  founding_member: true,
  referral_code: "abcd1234",
  referred_by: null,
  source: "=HYPERLINK(1)",
  created_at: "2026-11-17T10:00:00.000Z",
  invited_at: null,
  position: 3,
  referrals: 2,
};

test("the CSV has a header, quotes every field and defuses formulas", () => {
  const [head, row] = waitlistCsv([entry]).trimEnd().split("\r\n");
  assert.match(head ?? "", /^"position","created_at","email","name"/);
  assert.match(row ?? "", /"Ana ""the founder"", Jr"/);
  assert.match(row ?? "", /"'=HYPERLINK\(1\)"/);
  assert.match(row ?? "", /^"3","2026-11-17T10:00:00.000Z","ana@example.com"/);
});
