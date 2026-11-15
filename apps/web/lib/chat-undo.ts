// Chat after an action (#385): the reply's own "Undo" or "Undo until 15:00." says what the chip under
// it already says ("Done. Undo until 15:00"), so the web drops the words and keeps the chip. Other
// channels (Telegram, the watch) have no chip and keep the line from the server.

const UNDO = /(^|[.!?]\s+)Undo(?: until \d{1,2}:\d{2})?(?:\.(?=\s|$)|$)/g;

/** The reply without its Undo sentence, when a chip under it offers the Undo. */
export function withoutUndoLine(text: string): string {
  const out = text
    .replace(UNDO, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return out || text;
}
