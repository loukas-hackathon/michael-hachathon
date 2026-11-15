"use server";

import { BlockCreate, BlockUpdate } from "@michael/shared";
import { deleteBlock, patchBlock, postBlock, undoRecommendation } from "@/lib/api";

// The Timeline's edits (#271): add, move, resize, rename, set the goal, remove, and undo. Each
// answers in place; the screen refreshes itself once the change has landed.

export type BlockEdit =
  | { ok: true; id: string | null; recId: string; undoUntil: string }
  | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: string) => UUID.test(v);

function done(res: Awaited<ReturnType<typeof postBlock>>): BlockEdit {
  if (!res.ok) return { ok: false, message: res.message };
  return {
    ok: true,
    id: res.change.event?.id ?? null,
    recId: res.change.recommendation_id,
    undoUntil: res.change.undo_until,
  };
}

const invalid = { ok: false, message: "That change does not look right." } as const;

export async function addBlock(input: BlockCreate): Promise<BlockEdit> {
  const p = BlockCreate.safeParse(input);
  if (!p.success) return invalid;
  return done(await postBlock(p.data));
}

export async function changeBlock(id: string, input: BlockUpdate): Promise<BlockEdit> {
  const p = BlockUpdate.safeParse(input);
  if (!isId(id) || !p.success) return invalid;
  return done(await patchBlock(id, p.data));
}

export async function removeBlock(id: string): Promise<BlockEdit> {
  if (!isId(id)) return invalid;
  return done(await deleteBlock(id));
}

export async function undoBlockChange(recId: string): Promise<{ ok: boolean; message: string | null }> {
  if (!isId(recId)) return invalid;
  const res = await undoRecommendation(recId);
  return res.ok ? { ok: true, message: null } : { ok: false, message: res.message };
}
