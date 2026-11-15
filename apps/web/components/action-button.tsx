"use client";

import { useActionState } from "react";

/** What a server action tells the button: the line to show in place, and whether it worked. */
export type ActionResult = { ok: boolean; message: string } | null;

/**
 * One button that runs a server action with honest feedback (michael-feedback R1, R4): the label
 * becomes the pending verb at once, the button cannot send twice, and the result lands as one line
 * under it ("Synced at 14:02." or "I couldn't reach Google. Try again.").
 */
export function ActionButton({
  action,
  label,
  pendingLabel,
  className,
  showResult = true,
}: {
  action: () => Promise<ActionResult>;
  label: string;
  pendingLabel: string;
  className: string;
  /** Rows with no room for a line still get the pending label and the refreshed status. */
  showResult?: boolean;
}) {
  const [result, run, pending] = useActionState<ActionResult>(async () => {
    try {
      return await action();
    } catch {
      return { ok: false, message: "I lost the line. Nothing changed." };
    }
  }, null);

  return (
    <span className="flex flex-col">
      <form action={run}>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className={`${className} disabled:opacity-60`}
        >
          {pending ? pendingLabel : label}
        </button>
      </form>
      {showResult && result && !pending ? (
        <span
          key={result.message}
          role={result.ok ? "status" : "alert"}
          className={`m-swap text-footnote ${result.ok ? "text-label-2" : "text-danger"}`}
        >
          {result.message}
        </span>
      ) : null}
    </span>
  );
}
