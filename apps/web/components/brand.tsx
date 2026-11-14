// Michael brand marks, traced from the locked logo (Build Hub, "Logo"). Masters: ~/code/michael-brand.
// Both use currentColor, so they take the text colour of their parent.
// The path data lives in public/brand.svg (one cached file), not here: these marks sit in the tab
// bar, the header and the error screen, so inline paths rode along in every route's JavaScript (#255).

type MarkProps = { className?: string; title?: string };

export function MiMark({ className, title }: MarkProps) {
  return (
    <svg viewBox="0 0 346 209" className={className} role="img">
      <title>{title ?? "Michael"}</title>
      <use href="/brand.svg#mi" />
    </svg>
  );
}

export function Wordmark({ className, title = "Michael" }: MarkProps) {
  return (
    <svg viewBox="0 0 1014 209" className={className} role="img">
      <title>{title}</title>
      <use href="/brand.svg#wordmark" />
    </svg>
  );
}
