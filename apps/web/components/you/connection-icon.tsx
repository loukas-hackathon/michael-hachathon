import type { ConnectionId } from "@/lib/connections";

// Line icons for the Connections rows, drawn on a 24px grid in currentColor. Our own shapes,
// no brand marks and no tinted squares (design guide: icons).

const paths: Record<ConnectionId, React.ReactNode> = {
  "google-calendar": (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <path d="M8 14h3M8 17h6" />
    </>
  ),
  "apple-watch": (
    <>
      <rect x="6" y="6" width="12" height="12" rx="3.5" />
      <path d="M9 6l.6-3h4.8l.6 3M9 18l.6 3h4.8l.6-3" />
      <path d="M9.5 12h1.5l1-2 1.5 4 1-2h1" />
    </>
  ),
  mac: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20.5h6M12 16.5v4" />
    </>
  ),
  windows: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2.5 19h19" />
      <path d="M12 7.5v6M8.5 10.5h7" />
    </>
  ),
  iphone: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="3" />
      <path d="M10.5 5h3" />
      <path d="M9.5 15.5v2M12 12.5v5M14.5 10v7.5" />
    </>
  ),
  claude: (
    <>
      <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.8 2.8M15.2 15.2L18 18M18 6l-2.8 2.8M8.8 15.2L6 18" />
    </>
  ),
  nudges: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  telegram: (
    <>
      <path d="M20.5 4.5L3.5 11l6 2.2M20.5 4.5L17.5 19.5l-8-6.3M20.5 4.5L9.5 13.2v5.3l3-3" />
    </>
  ),
  travel: (
    <>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
};

export function ConnectionIcon({ id, className = "size-6" }: { id: ConnectionId; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[id]}
    </svg>
  );
}
