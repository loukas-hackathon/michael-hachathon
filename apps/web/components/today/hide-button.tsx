"use client";

import { useFormStatus } from "react-dom";

/** "Hide for now" on the Get started card: answers the tap at once and cannot send twice. */
export function HideButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="press -mr-2 flex min-h-11 min-w-[112px] items-center justify-end px-2 text-subhead font-semibold text-tint-text disabled:opacity-60"
    >
      {pending ? "Hiding" : "Hide for now"}
    </button>
  );
}
