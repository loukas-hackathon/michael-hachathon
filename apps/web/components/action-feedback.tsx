"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

// The visible half of lib/use-action.ts (.claude/skills/michael-feedback): a button that says what
// it is doing, and an error line with a retry. Server forms use components/action-button.tsx.
// Never a spinner, never a toast. Colours and type come from the design guide.

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  /** True from the tap until the server answers: the button shows `pendingLabel` and is disabled. */
  pending?: boolean;
  /** The pending verb, for example "Saving". The button keeps the width of the longer label. */
  pendingLabel?: ReactNode;
  /** Where the shorter label sits: centred for capsules, start for full width rows. */
  align?: "center" | "start";
};

/**
 * A button for an action. The label and the pending label share one grid cell, so the button keeps
 * its width while the text swaps and nothing beside it moves.
 */
export function PendingButton({
  children,
  pending = false,
  pendingLabel,
  align = "center",
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button type={type} {...rest} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pendingLabel === undefined ? (
        children
      ) : (
        <span
          className={`inline-grid items-center ${align === "start" ? "justify-items-start" : "justify-items-center"}`}
        >
          <span className={`col-start-1 row-start-1 ${pending ? "invisible" : ""}`}>{children}</span>
          <span aria-hidden={!pending} className={`col-start-1 row-start-1 ${pending ? "" : "invisible"}`}>
            {pendingLabel}
          </span>
        </span>
      )}
    </button>
  );
}

/** Michael's words when an action failed, next to the control, with one tap to try again. */
export function ActionError({
  error,
  onRetry,
  className = "",
}: {
  error: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  if (!error) return null;
  return (
    <p role="alert" className={`m-swap text-footnote text-danger ${className}`}>
      {error}
      {onRetry ? (
        <>
          {" "}
          <button
            type="button"
            onClick={onRetry}
            className="press relative font-semibold text-tint-text before:absolute before:-inset-3 before:content-['']"
          >
            Try again
          </button>
        </>
      ) : null}
    </p>
  );
}
