"use client";

import { useState } from "react";

/**
 * Every action Michael takes can be undone until its event starts. Feedback appears in place,
 * never as a toast. TODO(#49 follow up): call POST /v1/recommendations/:id/undo once it is live.
 */
export function UndoButton({ label, done }: { label: string; done: string }) {
  const [undone, setUndone] = useState(false);
  if (undone) {
    return (
      <p className="flex min-h-9 items-center text-subhead text-label-2" role="status">
        {done}
      </p>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setUndone(true)}
        className="press relative min-h-9 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']"
      >
        {label}
      </button>
    </div>
  );
}
