"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { undoRecommendationAction } from "@/lib/recommendation-actions";

/**
 * Every action Michael takes can be undone until its event starts. Feedback appears in place,
 * never as a toast. With a `recommendationId` it calls POST /v1/recommendations/:id/undo
 * (optimistic, rolled back with Michael's reason if it fails); without one (the sample day) it
 * only shows the result.
 */
export function UndoButton({
  label,
  done,
  recommendationId,
}: {
  label: string;
  done: string;
  recommendationId?: string;
}) {
  const router = useRouter();
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function undo() {
    setUndone(true);
    setError(null);
    if (!recommendationId) return;
    const r = await undoRecommendationAction(recommendationId).catch(() => ({
      ok: false as const,
      error: "I could not reach the server. Nothing changed.",
    }));
    if (r.ok) router.refresh();
    else {
      setUndone(false);
      setError(r.error);
    }
  }

  if (undone) {
    return (
      <p className="m-swap flex min-h-9 items-center text-subhead text-label-2" role="status">
        {done}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {error ? (
        <p role="alert" className="text-subhead text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <button
          type="button"
          onClick={undo}
          className="press relative min-h-9 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']"
        >
          {label}
        </button>
      </div>
    </div>
  );
}
