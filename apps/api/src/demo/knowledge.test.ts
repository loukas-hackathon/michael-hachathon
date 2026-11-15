import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { runAsUser } from "../context";
import { knowledgeFor } from "../knowledge";
import { remember } from "../memory";
import { store } from "../store";
import { seedDemoKnowledge } from "./knowledge";
import { buildDemoWeek } from "./week";

// The demo week's "What I know about you" (#379): three memories and one answered check in, the
// same rows on every refresh, and a reset takes rehearsal memories away.

test("demo knowledge: seeded once, stable on refresh, a reset drops rehearsal memories", () =>
  runAsUser(
    randomUUID(),
    async () => {
      const { days } = buildDemoWeek(new Date());
      await seedDemoKnowledge(store, days, { reset: false });
      const first = await knowledgeFor();
      const memories = first.told.filter((i) => i.kind === "memory");
      assert.deepEqual(memories.map((m) => m.text).sort(), [
        "Exams start 1 December",
        "Friday evenings are for family",
        "Prefers training before 08:00",
      ]);
      const checkIns = first.told.filter((i) => i.kind === "check_in");
      assert.equal(checkIns.length, 1);
      assert.equal(checkIns[0]?.answer, "yes");

      await seedDemoKnowledge(store, days, { reset: false });
      const again = await knowledgeFor();
      assert.deepEqual(
        again.told.filter((i) => i.kind !== "instruction").map((i) => i.id),
        first.told.filter((i) => i.kind !== "instruction").map((i) => i.id),
        "the same rows, same ids",
      );

      await remember("Rehearsal fact", "chat");
      await seedDemoKnowledge(store, days, { reset: true });
      const reset = await knowledgeFor();
      assert.ok(!reset.told.some((i) => i.text === "Rehearsal fact"));
      assert.equal(reset.told.filter((i) => i.kind === "memory").length, 3);
    },
    "api_key",
  ));
