// Where a nudge's tap lands (#399, nudgeUrl in @michael/shared): ?block=<event id> on the
// Timeline, ?card=<recommendation id> on Today. Pure, so it is tested without a browser.

const SAFE = /^[\w@.-]{1,200}$/;

/** The CSS selector for the block or card the URL points at, or null. */
export function deepLinkSelector(search: string): string | null {
  const q = new URLSearchParams(search);
  const card = q.get("card");
  if (card && SAFE.test(card)) return `[data-rec-id="${card}"]`;
  const block = q.get("block");
  if (block && SAFE.test(block)) return `[data-block-id="${block}"]`;
  return null;
}
