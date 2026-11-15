"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useSmoothHeight } from "./motion";

/**
 * A bottom sheet with one job (docs/design-guide.md): grabber, swipe down or tap outside to close,
 * the iOS curve on the way in. Built on <dialog> so focus, Escape and the backdrop come for free.
 */
export function Sheet({
  open,
  onClose,
  title,
  trailing,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  // Content mounts when the sheet opens and stays through the slide down, then unmounts.
  const [render, setRender] = useState(open);
  useEffect(() => {
    if (open) {
      setRender(true);
      return;
    }
    const t = setTimeout(() => setRender(false), 500);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal focuses the first control (Cancel), and some browsers ring it even after a tap.
      // Focus the sheet itself instead: screen readers hear its title, the next Tab reaches Cancel.
      d.focus({ focusVisible: false } as FocusOptions);
    }
    if (!open && d.open) d.close();
  }, [open]);

  // Once open with its content in, a change of content height (a step, a detail, a loaded list)
  // eases the sheet to its new height instead of jumping.
  useSmoothHeight(ref, open && render);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = drag.current;
    const d = ref.current;
    if (!s || !d) return;
    // Upwards drag meets friction; downwards follows the finger.
    s.dy = e.clientY - s.y;
    const y = s.dy > 0 ? s.dy : s.dy / 6;
    d.style.transition = "none";
    d.style.transform = `translateY(${y}px)`;
  };
  const onPointerUp = () => {
    const s = drag.current;
    const d = ref.current;
    drag.current = null;
    if (!s || !d) return;
    const velocity = s.dy / Math.max(1, performance.now() - s.t);
    d.style.transform = "";
    if (s.dy > 120 || velocity > 0.5) {
      // Let go far or fast enough: it carries on down from where the finger left it.
      d.style.transition = "";
      onClose();
      return;
    }
    // Not far enough: it settles back on the spring, then the stylesheet takes over again.
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      d.style.transition = "";
      return;
    }
    d.style.transition = "transform var(--m-dur-spring) var(--m-spring)";
    d.addEventListener(
      "transitionend",
      () => {
        d.style.transition = "";
      },
      { once: true },
    );
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click closes on a backdrop tap; Escape closes the dialog natively
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-sheet"
    >
      <div className="flex max-h-[92dvh] flex-col">
        <div
          className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2 pb-1"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span aria-hidden="true" className="h-[5px] w-9 rounded-full bg-context" />
          <div className="mt-2 grid w-full grid-cols-[1fr_auto_1fr] items-center px-4">
            <button
              type="button"
              onClick={onClose}
              className="press -ml-2 h-11 justify-self-start rounded-control px-2 text-body text-tint-text"
            >
              Cancel
            </button>
            <h2 className="text-body font-semibold">{title}</h2>
            <div className="justify-self-end">{trailing}</div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-[calc(24px+env(safe-area-inset-bottom))]">
          {render ? children : null}
        </div>
      </div>
    </dialog>
  );
}
