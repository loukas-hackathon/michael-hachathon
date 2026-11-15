import assert from "node:assert/strict";
import { test } from "node:test";
import { connectOutcome, consentPath, signInAgainPath } from "./connect-outcome";
import { safeNext } from "./next-path";

test("every API answer has a next step, never a raw error page", () => {
  assert.equal(connectOutcome(200), "ok");
  assert.equal(connectOutcome(404), "expired");
  assert.equal(connectOutcome(409), "expired");
  assert.equal(connectOutcome(400), "expired");
  // A deleted account's session (production, 14 Nov): sign in again.
  assert.equal(connectOutcome(401), "signed_out");
  assert.equal(connectOutcome(502), "failed");
  assert.equal(connectOutcome(500), "failed");
});

test("signing in again comes back to the same consent page", () => {
  const id = "4f4bf0e5-45d3-4dda-a340-c75edf13623b";
  const path = signInAgainPath(id);
  const url = new URL(path, "https://michael.example");
  assert.equal(url.pathname, "/auth/signout");
  const next = url.searchParams.get("next");
  assert.equal(next, `/connect?request=${id}`);
  assert.equal(safeNext(next), next);
  assert.equal(consentPath(id, true), `/connect?request=${id}&error=failed`);
});
