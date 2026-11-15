import {
  type Instruction,
  InstructionCreate,
  InstructionUpdate,
  instructionShapeError,
} from "@michael/shared";
import { Hono } from "hono";
import { HttpError, jsonBody, parse } from "../http";
import { store } from "../store";

type Rule = Pick<Instruction, "kind" | "text"> & {
  days?: number[] | null;
  time?: string | null;
  end_time?: string | null;
};

const EVERY_DAY = "0,1,2,3,4,5,6";
/** The days a rule holds on, as one comparable string. A home_by or quiet_hours without days is every day. */
const daysOf = (i: Rule): string =>
  i.days?.length
    ? [...new Set(i.days)].sort((a, b) => a - b).join(",")
    : i.kind === "clear_day"
      ? ""
      : EVERY_DAY;
/** The user's words, compared loosely: case, spacing and a closing full stop do not make a new rule. */
const wordsOf = (text: string): string =>
  text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .toLowerCase();

/**
 * True when two instructions are the same rule: the same kind on the same days with the same time
 * and end time, or the same words. A custom one is only its words. Exceptions do not make a
 * different rule: change them on the one that exists.
 */
export function sameInstruction(a: Rule, b: Rule): boolean {
  if (wordsOf(a.text) === wordsOf(b.text)) return true;
  if (a.kind !== b.kind || a.kind === "custom") return false;
  return (
    daysOf(a) === daysOf(b) &&
    (a.time ?? null) === (b.time ?? null) &&
    (a.end_time ?? null) === (b.end_time ?? null)
  );
}

/** POST /v1/instructions, and Michael's add_instruction in chat. The same active rule twice is refused. */
export async function createInstruction(raw: unknown): Promise<Instruction> {
  const input = parse(InstructionCreate, raw);
  const existing = await store.listInstructions();
  if (existing.some((i) => i.active && sameInstruction(i, input))) {
    throw new HttpError("conflict", "You already have that one.");
  }
  return store.createInstruction(input);
}

/** PATCH /v1/instructions/:id, and Michael's update_instruction in chat. */
export async function updateInstruction(id: string, raw: unknown): Promise<Instruction> {
  const patch = parse(InstructionUpdate, raw);
  const current = (await store.listInstructions()).find((i) => i.id === id);
  if (!current) throw new HttpError("not_found", "Instruction not found");
  // The shape is checked on the result: a clear_day must keep its days, a home_by its time.
  const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const problem = instructionShapeError({ ...current, ...changes });
  if (problem) throw new HttpError("bad_request", "Validation failed", [{ message: problem }]);
  const instruction = await store.updateInstruction(id, patch);
  if (!instruction) throw new HttpError("not_found", "Instruction not found");
  return instruction;
}

// Standing instructions: the user's ground rules ("keep Sundays clear", "home every day by 21:00").
// They are not goals. Michael never plans into the time they protect (instructions/protected.ts).
export const instructions = new Hono()
  .get("/instructions", async (c) => c.json({ instructions: await store.listInstructions() }))
  .post("/instructions", async (c) => c.json(await createInstruction(await jsonBody(c)), 201))
  .patch("/instructions/:id", async (c) =>
    c.json(await updateInstruction(c.req.param("id"), await jsonBody(c))),
  )
  .delete("/instructions/:id", async (c) => {
    if (!(await store.deleteInstruction(c.req.param("id")))) {
      throw new HttpError("not_found", "Instruction not found");
    }
    return c.body(null, 204);
  });
