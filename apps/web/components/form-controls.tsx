"use client";

import type { ReactNode } from "react";

// Form pieces in Apple's grouped style, shared by every sheet.

/** Apple style segmented control on radio inputs, so the form posts the value. */
export function Segmented<T extends string>({
  name,
  options,
  value,
  onChange,
  disabled = [],
  size = "md",
  labelledBy,
}: {
  name: string;
  options: { value: T; label: string }[];
  /** Nothing chosen yet: a value no option has (no pill shows). */
  value: T | "";
  onChange: (v: T) => void;
  disabled?: T[];
  /** "lg": 44px segments for a question that leads a screen (the /join hours). */
  size?: "md" | "lg";
  labelledBy?: string;
}) {
  const n = options.length;
  const index = options.findIndex((o) => o.value === value);
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="relative grid gap-[2px] rounded-[9px] bg-fill p-[2px]"
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
    >
      {/* One pill that slides to the chosen segment, as UISegmentedControl does. */}
      {index >= 0 ? (
        <span
          aria-hidden="true"
          className="m-seg-thumb absolute top-[2px] bottom-[2px] left-[2px] rounded-[7px] bg-bg shadow-[0_1px_3px_rgb(0_0_0/0.12)]"
          style={{
            width: `calc((100% - 4px - ${(n - 1) * 2}px) / ${n})`,
            transform: `translateX(calc(${index} * (100% + 2px)))`,
          }}
        />
      ) : null}
      {options.map((o) => (
        <label
          key={o.value}
          className={`relative flex items-center justify-center rounded-[7px] active:opacity-60 px-1 text-center font-semibold text-label ${size === "lg" ? "min-h-11 text-subhead tnum" : "min-h-9 text-footnote"} ${disabled.includes(o.value) ? "opacity-40" : ""}`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-11 items-center gap-3 px-4 [&+&]:before:absolute [&+&]:before:inset-x-0 [&+&]:before:top-0 [&+&]:before:ml-4 [&+&]:before:h-[0.5px] [&+&]:before:bg-separator [&+&]:before:content-['']">
      <label htmlFor={htmlFor} className="shrink-0 text-body">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </div>
  );
}

export const input =
  "w-full min-w-0 bg-transparent text-right text-body text-label outline-none placeholder:text-label-2 focus-visible:outline-none";
