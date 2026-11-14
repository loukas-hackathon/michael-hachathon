import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { runAsUser } from "./context";
import { forget, listMemories, memoryContext, remember } from "./memory";

test("memories: kept once, read back newest first, forgotten on request", () =>
  runAsUser(
    randomUUID(),
    async () => {
      const a = await remember("  Trains best   before 08:00 ", "chat");
      assert.ok(a);
      assert.equal(a.text, "Trains best before 08:00");
      const again = await remember("trains best before 08:00", "agent");
      assert.equal(again?.id, a.id, "the same fact is kept once");
      const b = await remember("Fridays are for family", "agent");
      assert.ok(b);
      const list = await listMemories();
      const ids = list.map((m) => m.id);
      assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id), "newest first");
      assert.equal(list.find((m) => m.id === b.id)?.from, "agent");
      assert.match(memoryContext(list) ?? "", /Fridays are for family \{memory_id /);
      assert.equal(await forget(a.id), true);
      assert.ok(!(await listMemories()).some((m) => m.id === a.id));
      assert.equal(await forget(a.id), false);
    },
    "script",
  ));

test("memories: an empty context says nothing", () => {
  assert.equal(memoryContext([]), null);
});
