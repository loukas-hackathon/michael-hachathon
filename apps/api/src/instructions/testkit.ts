import type { Store } from "../store";

/**
 * Removes the current user's standing instructions. The memory store starts every user with the
 * mock "Keep Sundays clear", so a test that books relative to now ("tomorrow at 10:00") would be
 * refused on a Saturday. Tests about calendar actions, not about instructions, start without them.
 */
export async function withoutInstructions(store: Pick<Store, "listInstructions" | "deleteInstruction">) {
  for (const i of [...(await store.listInstructions())]) await store.deleteInstruction(i.id);
}
