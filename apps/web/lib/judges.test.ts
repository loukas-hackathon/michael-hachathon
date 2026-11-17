import assert from "node:assert/strict";
import { test } from "node:test";
import { isJudgeLogin, JUDGE_EMAIL, JUDGE_PASSWORD } from "./judges";

test("the published judges login opens the demo week, nothing else does", () => {
  assert.equal(isJudgeLogin(JUDGE_EMAIL, JUDGE_PASSWORD), true);
  assert.equal(isJudgeLogin(" Judges@Michael.app ", JUDGE_PASSWORD), true);
  assert.equal(isJudgeLogin(JUDGE_EMAIL, "wrong"), false);
  assert.equal(isJudgeLogin("someone@michael.app", JUDGE_PASSWORD), false);
});
