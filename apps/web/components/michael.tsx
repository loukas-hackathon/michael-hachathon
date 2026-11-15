// Michael's character (#319, direction 1 "the dot"): the Mi mark as it is, with only the dot of
// the i alive. It blinks at rest, drifts while thinking, swells while speaking, opens up while
// listening, lifts once when pleased, tilts when a goal is behind and sinks when asleep. The mark
// is never redrawn: public/brand.svg holds it split into `mi-body` and `mi-dot` at its own edge.
// Motion lives in globals.css (.m-mi); under reduced motion every state is a still pose.

export type MichaelState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "pleased"
  | "concerned"
  | "asleep";

export function Michael({
  state = "idle",
  className,
  title = "Michael",
}: {
  state?: MichaelState;
  className?: string;
  title?: string;
}) {
  return (
    <svg viewBox="0 0 346 209" className={`m-mi ${className ?? ""}`} data-mi={state} role="img">
      <title>{title}</title>
      <use href="/brand.svg#mi-body" />
      <use href="/brand.svg#mi-dot" className="m-mi-dot" />
    </svg>
  );
}
