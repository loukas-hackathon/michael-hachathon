"use client";

import { useEffect, useRef, useState } from "react";
import { haptic } from "@/components/haptics";

// The personal invite link, the share moment. On a phone with the share sheet: Share invite is the
// one filled (pink) control and Copy link is tinted beside it. On a laptop: Copy link is filled,
// then plain links to email and X. Copy answers in place, under the buttons, with one tick:
// "Copied. Send it to a friend." for two seconds, or how to copy by hand. No toasts.

/** In the user's own voice: what a friend reads above the link. */
const SHARE_TEXT =
  "I'm on the list for Michael. It finds the time you lose every day and gives it back to your goals.";

const TINTED = "bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] text-tint-text";
const FILLED = "bg-tint text-on-tint";

export function InviteLink({ link }: { link: string }) {
  const [phone, setPhone] = useState(false);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPhone(typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches);
    return () => clearTimeout(timer.current);
  }, []);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(link);
      setState("copied");
      // Filled buttons tick on their own (components/haptics.tsx); the tinted one says it here.
      if (phone) haptic();
    } catch {
      // No clipboard (an old browser, an iframe): select the link so a long press copies it.
      field.current?.select();
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  async function share() {
    try {
      await navigator.share({ title: "Michael", text: SHARE_TEXT, url: link });
    } catch {
      // Closed the sheet: nothing to say.
    }
  }

  const button =
    "press flex h-12 min-w-0 flex-1 items-center justify-center rounded-full px-5 text-body font-semibold";
  const mail = `mailto:?subject=${encodeURIComponent("A place on Michael's list")}&body=${encodeURIComponent(`${SHARE_TEXT}\n\n${link}`)}`;
  const tweet = `https://x.com/intent/post?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(link)}`;

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
        {phone ? (
          <>
            <button type="button" onClick={share} className={`${button} ${FILLED}`}>
              Share invite
            </button>
            <button type="button" onClick={copy} className={`${button} ${TINTED}`}>
              Copy link
            </button>
          </>
        ) : (
          <button type="button" onClick={copy} className={`${button} ${FILLED}`}>
            Copy link
          </button>
        )}
      </div>
      <p role="status" className="m-swap mt-2 min-h-[18px] px-4 text-footnote text-label-2" key={state}>
        {state === "copied"
          ? "Copied. Send it to a friend."
          : state === "failed"
            ? "Press and hold the link to copy it."
            : ""}
      </p>
      {phone ? null : (
        <div className="-ml-2 flex gap-2">
          <a
            href={mail}
            className="press inline-flex h-11 items-center rounded-control px-2 text-body font-semibold text-label"
          >
            Email it
          </a>
          <a
            href={tweet}
            target="_blank"
            rel="noopener noreferrer"
            className="press inline-flex h-11 items-center rounded-control px-2 text-body font-semibold text-label"
          >
            Post on X
          </a>
        </div>
      )}
    </div>
  );
}
