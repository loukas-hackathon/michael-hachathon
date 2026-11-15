"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

// The pinned action at the bottom of an onboarding screen. On a phone it sits on the page colour
// right down to the screen's edge, so nothing peeks out beneath it, and it draws a hairline on top
// only while content runs under it, as an iOS toolbar does at its scroll edge. At rest, or once the
// last row is in view, there is no edge at all: no band slicing a group, no gradient. On a laptop
// it sits in the flow under the body.

export function FrameFooter({ children }: { children: ReactNode }) {
  const end = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [under, setUnder] = useState(false);

  useEffect(() => {
    const mark = end.current;
    const el = bar.current;
    if (!mark || !el || typeof IntersectionObserver === "undefined") return;
    let io: IntersectionObserver | null = null;
    let height = -1;
    const watch = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h === height) return;
      height = h;
      io?.disconnect();
      // The visible page minus the bar: the end of the content is "under" when it is not in there.
      io = new IntersectionObserver(
        ([e]) => setUnder(e ? !e.isIntersecting && e.boundingClientRect.top > 0 : false),
        { rootMargin: `0px 0px -${h}px 0px` },
      );
      io.observe(mark);
    };
    watch();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(watch);
    ro?.observe(el);
    return () => {
      io?.disconnect();
      ro?.disconnect();
    };
  }, []);

  return (
    <>
      {/* The end of the body: one pixel tall, so it is "in view" exactly when the last row is. */}
      <span ref={end} aria-hidden="true" className="-mt-px block h-px" />
      <div
        ref={bar}
        data-under={under ? "" : undefined}
        className="m-step-part sticky bottom-0 z-10 mt-8 bg-bg pt-3 pb-[calc(16px+env(safe-area-inset-bottom))] lg:static lg:mt-12 lg:pb-0"
      >
        <span
          aria-hidden="true"
          className="m-edge absolute -inset-x-4 top-0 h-[0.5px] bg-separator lg:hidden"
        />
        {children}
      </div>
    </>
  );
}
