"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { RichText } from "./rich-text";

const HOLD_MS = 450;

/**
 * One line of the conversation. Michael's answers get light formatting; the user's stay as typed.
 * Press and hold (or right click) shows Copy under the bubble, as in Messages.
 */
export function MessageBubble({
  role,
  content,
  streaming = false,
  arriving = false,
  children,
}: {
  role: "user" | "assistant";
  content: string;
  /** Michael is still writing: a caret follows the last word. */
  streaming?: boolean;
  /** Just arrived: grows from its own corner (useArrival). */
  arriving?: boolean;
  /** Under the bubble: action chips and the time. */
  children?: ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<HTMLLIElement>(null);
  const mine = role === "user";

  // Any tap outside closes the menu.
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  const cancel = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setMenu(false);
      }, 1200);
    } catch {
      setMenu(false);
    }
  }

  const caret = streaming ? <span aria-hidden className="m-caret" /> : null;

  return (
    <li ref={root} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: press and hold is a shortcut; the text stays selectable with a mouse and readable by VoiceOver. */}
      <div
        onContextMenu={(e) => {
          if (streaming) return;
          e.preventDefault();
          setMenu(true);
        }}
        onPointerDown={(e) => {
          if (streaming || e.pointerType === "mouse") return;
          cancel();
          hold.current = setTimeout(() => {
            setMenu(true);
            navigator.vibrate?.(8);
          }, HOLD_MS);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        className={`max-w-[85%] rounded-card px-3.5 py-2 text-body tnum [overflow-wrap:anywhere] [-webkit-touch-callout:none] pointer-coarse:select-none transition-transform duration-[var(--m-dur-press)] ease-[var(--m-ease-out)] ${
          menu ? "scale-[0.98]" : ""
        } ${mine ? "whitespace-pre-wrap bg-tint text-on-tint" : "bg-fill text-label"} ${
          arriving ? (mine ? "m-pop-in [--m-origin:100%_100%]" : "m-pop-in [--m-origin:0_100%]") : ""
        }`}
      >
        {mine ? content : <RichText text={content}>{caret}</RichText>}
      </div>
      {menu ? (
        <button
          type="button"
          onClick={copy}
          className={`press m-pop-in mt-1 min-h-9 rounded-full bg-fill px-3.5 text-subhead font-semibold text-label shadow-[0_0_0_0.5px_var(--m-separator)] ${mine ? "[--m-origin:100%_0]" : "[--m-origin:0_0]"}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      ) : null}
      {children}
    </li>
  );
}
