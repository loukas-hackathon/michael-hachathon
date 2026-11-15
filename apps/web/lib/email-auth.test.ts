import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceProblems } from "@michael/shared";
import { checkEmailForm, EMAIL_LINES, emailAuthLine, failWith } from "./email-auth";

test("Supabase Auth codes map to one line each", () => {
  const cases: [string, "signin" | "signup", string][] = [
    ["invalid_credentials", "signin", "wrong"],
    ["user_already_exists", "signup", "exists"],
    ["email_exists", "signup", "exists"],
    ["weak_password", "signup", "weak"],
    ["email_address_invalid", "signup", "email"],
    ["email_not_confirmed", "signin", "unconfirmed"],
    ["email_provider_disabled", "signup", "closed"],
    ["signup_disabled", "signup", "closed"],
    ["over_request_rate_limit", "signin", "busy"],
    ["over_email_send_rate_limit", "signup", "busy"],
  ];
  for (const [code, mode, line] of cases) assert.equal(emailAuthLine({ code }, mode), line, code);
});

test("older servers without a code still map by message", () => {
  assert.equal(emailAuthLine({ message: "Invalid login credentials", status: 400 }, "signin"), "wrong");
  assert.equal(emailAuthLine({ message: "User already registered", status: 422 }, "signup"), "exists");
  assert.equal(
    emailAuthLine({ message: "Password should be at least 8 characters.", status: 422 }, "signup"),
    "weak",
  );
  assert.equal(emailAuthLine({ message: "Email not confirmed", status: 400 }, "signin"), "unconfirmed");
  assert.equal(emailAuthLine({ message: "Signups not allowed for this instance" }, "signup"), "closed");
  assert.equal(emailAuthLine({ status: 429 }, "signin"), "busy");
});

test("anything unknown is a connection line, never a blank", () => {
  assert.equal(emailAuthLine({}, "signup"), "failed");
  assert.equal(emailAuthLine({ message: "fetch failed", status: 0 }, "signin"), "failed");
  assert.equal(emailAuthLine({ code: "unexpected_failure", status: 500 }, "signin"), "failed");
});

test("the form catches typos and short passwords before a round trip", () => {
  assert.equal(checkEmailForm("signup", "not-an-email", "longenough"), "email");
  assert.equal(checkEmailForm("signup", "a@b.co", "short"), "short");
  assert.equal(checkEmailForm("signup", " a@b.co ", "12345678"), null);
  // Signing in never says "too short": an old password is whatever it is.
  assert.equal(checkEmailForm("signin", "a@b.co", "short"), null);
  assert.equal(checkEmailForm("signin", "a@b.co", ""), "wrong");
});

test("every line is in Michael's voice", () => {
  for (const [key, line] of Object.entries(EMAIL_LINES)) {
    assert.deepEqual(voiceProblems(line), [], key);
    assert.ok(line.split(/\s+/).length < 15, `${key} is under 15 words`);
  }
  assert.deepEqual(failWith("exists"), { ok: false, line: "exists", text: EMAIL_LINES.exists });
});
