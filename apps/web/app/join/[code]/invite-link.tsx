"use client";

import { useEffect, useRef, useState } from "react";

// The personal invite link: Copy (the one filled button), and Share where the browser has the
// native share sheet. Copy answers in place: "Copied." for two seconds, or how to copy by hand.

export function InviteLink({ link }: { link: string }) {
  const [canShare, setCanShare] = useState(false);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCanShare(typeof navigator.share === "function");
    return () => clearTimeout(timer.current);
  }, []);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(link);
      setState("copied");
    } catch {
      // No clipboard (an old browser, an iframe): select the link so a long press copies it.
      field.current?.select();
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  async function share() {
    try {
      await navigator.share({
        title: "Michael",
        text: "Michael is on your side. Join the waiting list.",
        url: link,
      });
    } catch {
      // Closed the sheet: nothing to say.
    }
  }

  return (
    <div>
      <label htmlFor="invite-link" className="sr-only">
        Invite link
      </label>
      <input
        ref={field}
        id="invite-link"
        readOnly
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        className="h-11 w-full min-w-0 truncate rounded-control bg-fill px-4 text-subhead text-label outline-none"
      />
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={copy}
          className="press flex h-12 min-w-0 flex-1 items-center justify-center rounded-full bg-tint px-6 text-body font-semibold text-on-tint"
        >
          Copy link
        </button>
        {canShare ? (
          <button
            type="button"
            onClick={share}
            className="press flex h-12 min-w-0 flex-1 items-center justify-center rounded-full bg-fill px-6 text-body font-semibold text-label"
          >
            Share
          </button>
        ) : null}
      </div>
      <p role="status" className="m-swap mt-2 min-h-[18px] text-footnote text-label-2" key={state}>
        {state === "copied"
          ? "Copied. Send it to a friend."
          : state === "failed"
            ? "Press and hold the link to copy it."
            : ""}
      </p>
    </div>
  );
}
