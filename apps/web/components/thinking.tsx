import { Michael } from "./michael";

// "Michael is thinking" (#378): whenever a line written by the model is on its way, the Mi mark
// breathes slowly beside a few plain words, in place of what is coming. Never a spinner, never a
// blank. The mark takes the text colour (label 2); under reduced motion it stays still.

export function Thinking({
  text = "Reading your day",
  live = false,
  className = "text-footnote text-label-2",
}: {
  text?: string;
  /** Announce it (role="status"). Off inside a button, whose own name already reads it. */
  live?: boolean;
  /** Type and colour; the mark follows the text colour. */
  className?: string;
}) {
  return (
    <span role={live ? "status" : undefined} className={`inline-flex items-center gap-1.5 ${className}`}>
      <span aria-hidden="true" className="block w-[15px] shrink-0">
        <Michael state="thinking" className="block h-auto w-full" />
      </span>
      <span>{text}</span>
    </span>
  );
}
