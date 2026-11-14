// Our own four tab icons, drawn from the product: the tape, the timeline, the notched goal track, agents.
// 24px grid; they take currentColor.

type IconProps = { className?: string };

export function TodayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="3.5" y="6" width="2.6" height="12" rx="1.3" fill="currentColor" />
      <rect x="8.2" y="6" width="2.6" height="12" rx="1.3" fill="currentColor" />
      <rect x="12.9" y="11" width="2.6" height="7" rx="1.3" fill="currentColor" />
      <rect
        x="17.9"
        y="6.5"
        width="2.4"
        height="11"
        rx="1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function TimelineIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M5 3v18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="8" y="4.5" width="12" height="6" rx="2" fill="currentColor" />
      <rect
        x="8.7"
        y="13.2"
        width="10.6"
        height="6.3"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeDasharray="2.4 1.8"
      />
    </svg>
  );
}

export function GoalsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="2.5" y="8.5" width="4.4" height="7" rx="1.6" fill="currentColor" />
      <rect x="7.9" y="8.5" width="4.4" height="7" rx="1.6" fill="currentColor" />
      <rect
        x="14"
        y="9.2"
        width="3.4"
        height="5.6"
        rx="1.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect
        x="18.6"
        y="9.2"
        width="3.4"
        height="5.6"
        rx="1.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function AgentsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="3" y="4" width="10" height="10" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="11" y="10" width="10" height="10" rx="3" fill="currentColor" />
    </svg>
  );
}
