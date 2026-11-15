"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "./sheet";

/** Fire on window to open the keyboard shortcuts list (the sidebar's button does). */
export const SHOW_SHORTCUTS = "michael:show-shortcuts";

// Keys 1 to 4 follow the tab order in components/tab-bar.tsx.
const SECTIONS = ["/", "/timeline", "/goals", "/chat"];

const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ["1"], what: "Today" },
  { keys: ["2"], what: "Timeline" },
  { keys: ["3"], what: "Goals" },
  { keys: ["4"], what: "Chat" },
  { keys: ["/"], what: "Write to Michael" },
  { keys: ["Esc"], what: "Close a panel or leave the message field" },
  { keys: ["?"], what: "These shortcuts" },
];

// How long the pointer rests on an icon button before its name shows, as on macOS.
const TIP_DELAY_MS = 500;

function typing(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Focus the chat field once it is on screen (straight away, or after the route paints). */
function focusChat() {
  let tries = 0;
  const go = () => {
    const field = document.getElementById("chat-input");
    if (field instanceof HTMLTextAreaElement) {
      field.focus({ preventScroll: true });
      field.scrollIntoView({ block: "nearest" });
      return;
    }
    if (++tries < 60) requestAnimationFrame(go);
  };
  go();
}

/**
 * The laptop layer, mounted once in the root layout: keyboard shortcuts (1 to 4, /, Esc, ?), their
 * list, and the name of an icon only button after a short rest of the pointer. Nothing here is
 * the only way to do anything: every shortcut has a visible control, and every tooltip repeats
 * the control's accessible name. No motion on a section switch.
 */
export function Desktop() {
  const router = useRouter();
  const pathname = usePathname();
  const [shortcuts, setShortcuts] = useState(false);
  const wantChatFocus = useRef(false);

  useEffect(() => {
    const open = () => setShortcuts(true);
    window.addEventListener(SHOW_SHORTCUTS, open);
    return () => window.removeEventListener(SHOW_SHORTCUTS, open);
  }, []);

  // "/" pressed elsewhere: the field takes focus once Chat is on screen.
  useEffect(() => {
    if (pathname.startsWith("/chat") && wantChatFocus.current) {
      wantChatFocus.current = false;
      focusChat();
    }
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && typing(e.target) && !document.querySelector("dialog[open]")) {
        (e.target as HTMLElement).blur();
        return;
      }
      if (typing(e.target) || document.querySelector("dialog[open]")) return;
      const section = SECTIONS[Number(e.key) - 1];
      if (section && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        if (pathname !== section) router.push(section);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        if (pathname.startsWith("/chat")) focusChat();
        else {
          wantChatFocus.current = true;
          router.push("/chat");
        }
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setShortcuts(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname, router]);

  return (
    <>
      <Tooltip />
      <Sheet
        open={shortcuts}
        onClose={() => setShortcuts(false)}
        title="Keyboard shortcuts"
        closeLabel="Done"
      >
        <ul className="overflow-hidden rounded-group bg-fill">
          {SHORTCUTS.map((s, i) => (
            <li key={s.what} className="relative flex min-h-11 items-center justify-between gap-3 px-4 py-2">
              {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
              <span className="text-body">{s.what}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="m-kbd">
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 px-4 text-footnote text-label-2">Shortcuts wait while you type.</p>
      </Sheet>
    </>
  );
}

/** The name of an icon only control, under it, after the pointer rests. Mouse and trackpad only. */
function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Element | null = null;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as Element | null)?.closest?.("a[href],button,[role='button']") ?? null;
      if (el === current) return;
      hide();
      if (!el) return;
      const text = el.getAttribute("data-tip") ?? el.getAttribute("aria-label");
      // Only controls without visible words of their own: a labelled button already says it.
      if (!text || (el.textContent ?? "").trim() !== "") return;
      current = el;
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        setTip({ text, x: r.left + r.width / 2, y: r.bottom + 6 });
      }, TIP_DELAY_MS);
    };
    window.addEventListener("pointerover", over);
    window.addEventListener("pointerdown", hide);
    window.addEventListener("keydown", hide);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerover", over);
      window.removeEventListener("pointerdown", hide);
      window.removeEventListener("keydown", hide);
      window.removeEventListener("scroll", hide, { capture: true });
    };
  }, []);

  // Keep the tip inside the window once its width is known.
  useEffect(() => {
    const el = tipRef.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    const left = Math.min(Math.max(8, tip.x - w / 2), window.innerWidth - w - 8);
    el.style.left = `${left}px`;
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={tipRef} aria-hidden="true" className="m-tip" style={{ top: tip.y, left: tip.x }}>
      {tip.text}
    </div>
  );
}
