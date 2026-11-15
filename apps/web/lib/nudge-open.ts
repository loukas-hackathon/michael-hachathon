// A nudge opened from its notification. public/sw.js writes it into the URL fragment as
// #nudge=<json>, so it never reaches a server or a log; this reads it back, defensively.

export type OpenedNudge = { text: string; kind: string; at?: number };

export function nudgeFromHash(hash: string): OpenedNudge | null {
  if (!hash.startsWith("#nudge=")) return null;
  try {
    const raw: unknown = JSON.parse(decodeURIComponent(hash.slice("#nudge=".length)));
    if (!raw || typeof raw !== "object") return null;
    const { text, kind, at } = raw as Record<string, unknown>;
    if (typeof text !== "string" || !text.trim()) return null;
    return {
      text: text.slice(0, 300),
      kind: typeof kind === "string" ? kind.slice(0, 40) : "nudge",
      at: typeof at === "number" && Number.isFinite(at) ? at : undefined,
    };
  } catch {
    return null;
  }
}

/** The one place a nudge points to, by its kind, or none when the card itself is the answer. */
export function nudgeAction(kind: string): { href: string; label: string } | null {
  switch (kind) {
    case "block_soon":
    case "recovery_block":
    case "focus_drift":
      return { href: "/timeline", label: "See the block" };
    case "goal_behind":
      return { href: "/goals", label: "See the goal" };
    default:
      return null;
  }
}
