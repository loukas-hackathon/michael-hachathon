import assert from "node:assert/strict";
import { test } from "node:test";
import { knowledgeIntent } from "./knowledge-intent";

test("knowledge intent: asking what Michael knows gets the button", () => {
  assert.equal(knowledgeIntent("What do you know about me?"), true);
  assert.equal(knowledgeIntent("what do you remember about me"), true);
  assert.equal(knowledgeIntent("Show me everything you know about me"), true);
  assert.equal(knowledgeIntent("what have you stored about me?"), true);
});

test("knowledge intent: questions about the day get no button", () => {
  assert.equal(knowledgeIntent("what do you think about my week?"), false);
  assert.equal(knowledgeIntent("do you know when my gym block is?"), false);
  assert.equal(knowledgeIntent("remember I train before 08:00"), false);
});
