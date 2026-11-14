import { Fragment, type ReactNode } from "react";

// Markdown light for Michael's answers: paragraphs, line breaks, "-" and "1." lists and **bold**.
// Everything is rendered as React text, never as HTML, so nothing in a reply can inject markup.

/** A line of text with its position in the reply, which is its stable key. */
type Piece = { at: number; text: string };
type Block = { at: number; kind: "p" | "ul" | "ol"; lines: Piece[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let open = false;
  let at = 0;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const here = at;
    at += raw.length + 1;
    if (!raw.trim()) {
      // A blank line closes the paragraph or list; the next line starts a new block.
      open = false;
      continue;
    }
    const bullet = BULLET.exec(raw);
    const numbered = bullet ? null : NUMBERED.exec(raw);
    const kind = bullet ? "ul" : numbered ? "ol" : "p";
    const line = { at: here, text: (bullet ?? numbered)?.[1] ?? raw };
    const last = blocks.at(-1);
    // List items join the list above them even across a blank line; paragraphs need no gap.
    if (last && last.kind === kind && (open || kind !== "p")) last.lines.push(line);
    else blocks.push({ at: here, kind, lines: [line] });
    open = true;
  }
  return blocks;
}

/** "**47 minutes** lost" with the bold part in a <strong>. Unmatched asterisks stay as typed. */
function inline(text: string): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  for (const part of text.split(/(\*\*[^*\n]+\*\*)/g)) {
    const bold = part.length > 4 && part.startsWith("**") && part.endsWith("**");
    out.push(
      bold ? (
        <strong key={at} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <Fragment key={at}>{part}</Fragment>
      ),
    );
    at += part.length;
  }
  return out;
}

/** `children` (the streaming caret) follows the last word. */
export function RichText({ text, children }: { text: string; children?: ReactNode }) {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) return <>{children}</>;
  const lastBlock = blocks.at(-1);
  return (
    <>
      {blocks.map((b) => {
        const last = b === lastBlock;
        const lastLine = b.lines.at(-1);
        if (b.kind === "p") {
          return (
            <p key={b.at} className={last ? undefined : "mb-2"}>
              {b.lines.map((line) => (
                <Fragment key={line.at}>
                  {line.at !== b.at ? <br /> : null}
                  {inline(line.text)}
                </Fragment>
              ))}
              {last ? children : null}
            </p>
          );
        }
        const List = b.kind;
        return (
          <List
            key={b.at}
            className={`${b.kind === "ul" ? "list-disc" : "list-decimal"} pl-5 ${last ? "" : "mb-2"}`}
          >
            {b.lines.map((line) => (
              <li key={line.at} className="pl-0.5">
                {inline(line.text)}
                {last && line === lastLine ? children : null}
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}
