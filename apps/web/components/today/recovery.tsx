"use client";

import { useState } from "react";
import type { Recovery } from "@/lib/day";
import { formatTime } from "@/lib/format";

/**
 * After a missed block (#167): one tap adds the 25 minute block, and it can be undone until it starts.
 * TODO: POST /v1/recommendations/:id/execute and /undo once the recovery comes as a recommendation.
 */
export function RecoveryAction({ recovery }: { recovery: Recovery }) {
  const [taken, setTaken] = useState(false);
  if (taken) {
    return (
      <div className="flex flex-wrap items-center gap-x-2" role="status">
        <p className="text-subhead text-label-2 tnum">
          Added {formatTime(recovery.slotStart)} to {formatTime(recovery.slotEnd)}. Undo until{" "}
          {formatTime(recovery.undoUntil)}.
        </p>
        <button
          type="button"
          onClick={() => setTaken(false)}
          className="press min-h-9 px-1 text-subhead font-semibold text-tint-text"
        >
          Undo
        </button>
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setTaken(true)}
        className="press min-h-9 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint"
      >
        Take it
      </button>
    </div>
  );
}
