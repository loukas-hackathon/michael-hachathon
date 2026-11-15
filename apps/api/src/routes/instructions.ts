import {
  type Instruction,
  InstructionCreate,
  InstructionUpdate,
  instructionShapeError,
} from "@michael/shared";
import { Hono } from "hono";
import { HttpError, jsonBody, parse } from "../http";
import { store } from "../store";

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
  .post("/instructions", async (c) => {
    const instruction = await store.createInstruction(parse(InstructionCreate, await jsonBody(c)));
    return c.json(instruction, 201);
  })
  .patch("/instructions/:id", async (c) =>
    c.json(await updateInstruction(c.req.param("id"), await jsonBody(c))),
  )
  .delete("/instructions/:id", async (c) => {
    if (!(await store.deleteInstruction(c.req.param("id")))) {
      throw new HttpError("not_found", "Instruction not found");
    }
    return c.body(null, 204);
  });
