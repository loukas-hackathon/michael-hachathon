import { currentUserId } from "./context";

// A count of writes per user, bumped by the store (store.ts) around every write, so a cache of what
// a user's data says (the chat context, #364) knows when to read again. A write without a user (a
// background job outside runAsUser) bumps everyone.
const versions = new Map<string, number>();
let everyone = 0;

export function noteWrite(): void {
  let userId: string;
  try {
    userId = currentUserId();
  } catch {
    everyone++;
    return;
  }
  versions.set(userId, (versions.get(userId) ?? 0) + 1);
}

/** Changes whenever the user's data may have changed. */
export const writeVersion = (userId: string): string => `${everyone}:${versions.get(userId) ?? 0}`;
