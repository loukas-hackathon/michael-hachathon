"use client";

import { useFormStatus } from "react-dom";
import { skipMac } from "@/lib/no-mac-actions";

function Submit({ className, short }: { className: string; short?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      aria-label={short ? "Skip, I don't use a Mac" : undefined}
      className={className}
    >
      {pending ? "Skipping" : short ? "Skip" : "Skip, I don't use a Mac"}
    </button>
  );
}

/** "Skip, I don't use a Mac": the Mac stops counting as missing, here and on Today. */
export function SkipMacButton({ className = "", short }: { className?: string; short?: boolean }) {
  return (
    <form action={skipMac} className={className}>
      <Submit
        short={short}
        className="press flex min-h-11 items-center text-subhead font-semibold text-tint-text disabled:opacity-60"
      />
    </form>
  );
}
