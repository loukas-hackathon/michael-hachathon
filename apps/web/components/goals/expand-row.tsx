"use client";

import { type ReactNode, useId, useState } from "react";
import { Collapse } from "../motion-ui";

/**
 * A calm goal row that opens in place (#309): the summary is the button, the details (the week day
 * by day, the maths, Book and Edit) fold out underneath on the smooth spring.
 */
export function ExpandRow({
  summary,
  children,
  first,
}: {
  summary: ReactNode;
  children: ReactNode;
  first: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="relative">
      {first ? null : <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" />}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="press flex w-full items-start gap-2 px-4 pt-3 pb-3.5 text-left"
      >
        <div className="min-w-0 flex-1">{summary}</div>
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={`mt-[5px] size-3 shrink-0 text-label-2 transition-transform duration-[var(--m-dur-smooth)] ease-[var(--m-spring-smooth)] motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        >
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <Collapse open={open} id={id}>
        <div className="px-4 pb-4">{children}</div>
      </Collapse>
    </div>
  );
}
