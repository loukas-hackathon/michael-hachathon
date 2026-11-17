import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceProblems } from "@michael/shared";
import { checkEmailForm, EMAIL_LINES, emailAuthLine, failWith, signUpFlow, withinWait } from "./email-auth";

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

// 13:56 incident: createUser timed out yet made the account; the same password then signs in.
test("sign up: createUser times out, sign in works, lands on onboarding", async () => {
  const result = await signUpFlow({ createAccount: async () => "slow", signIn: async () => null });
  assert.deepEqual(result, { ok: true, isNew: true });
});

test("sign up: email_exists with the right password signs in", async () => {
  const result = await signUpFlow({ createAccount: async () => "exists", signIn: async () => null });
  assert.deepEqual(result, { ok: true, isNew: false });
});

test("sign up: email_exists with the wrong password says sign in instead", async () => {
  const result = await signUpFlow({
    createAccount: async () => "exists",
    signIn: async () => ({ code: "invalid_credentials", status: 400 }),
  });
  assert.deepEqual(result, { ok: false, line: "exists" });
});

test("sign up: timeout and a failed sign in end on the one calm line", async () => {
  const slowSignIn = await signUpFlow({ createAccount: async () => "slow", signIn: async () => "slow" });
  assert.deepEqual(slowSignIn, { ok: false, line: "slow" });
  const wrong = await signUpFlow({
    createAccount: async () => "slow",
    signIn: async () => ({ code: "invalid_credentials", status: 400 }),
  });
  assert.deepEqual(wrong, { ok: false, line: "slow" });
  assert.equal(EMAIL_LINES.slow, "That took too long on our side. Try again in a moment.");
});

test("sign up: created then signed in; busy and failed never try to sign in", async () => {
  assert.deepEqual(await signUpFlow({ createAccount: async () => "created", signIn: async () => null }), {
    ok: true,
    isNew: true,
  });
  let tried = false;
  const signIn = async () => {
    tried = true;
    return null;
  };
  assert.deepEqual(await signUpFlow({ createAccount: async () => "busy", signIn }), {
    ok: false,
    line: "busy",
  });
  assert.deepEqual(await signUpFlow({ createAccount: async () => "failed", signIn }), {
    ok: false,
    line: "failed",
  });
  assert.equal(tried, false);
});

test("withinWait: answers slow when the work outlasts the wait", async () => {
  assert.equal(await withinWait(new Promise(() => {}), 10), "slow");
  assert.equal(await withinWait(Promise.resolve(1), 1000), 1);
});
