"use client";

import type { ChatThread } from "@michael/shared";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { motionMs, reducedMotion } from "@/components/motion";
import { Sheet } from "@/components/sheet";
import { formatWhen } from "@/lib/format";
import {
  deleteThread,
  editThread,
  openThread,
  refreshThreads,
  undoDelete,
  useChatSession,
} from "./chat-session";
import { listThreads } from "./thread-actions";

// Width of the actions a row slides over: Rename, Pin, Delete.
const TRAY = 216;
// How far a row must be pulled before it stays open, and how long a press counts as a long press.
const OPEN_AT = 56;
const LONG_PRESS_MS = 480;

/**
 * Every conversation with Michael, as Messages lists them: pinned first, then the latest, each with
 * its title, last line and time. Swipe a row left (or long press it, or tap its More button) for
 * Rename, Pin and Delete. Delete waits five seconds with Undo before anything is removed.
 */
export function ThreadSheet({
  open,
  onClose,
  threads,
  currentKey,
  serverKey,
  onNew,
}: {
  open: boolean;
  onClose: () => void;
  /** All threads, including the ones waiting out their Undo. */
  threads: ChatThread[];
  currentKey: string;
  serverKey: string;
  onNew: () => void;
}) {
  const { deleting, listError } = useChatSession();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<ChatThread[] | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  // The list may have changed elsewhere (a title written after the first line): fetch it again,
  // showing what is here meanwhile.
  useEffect(() => {
    if (!open) return;
    void refreshThreads();
    setRevealed(null);
    setRenaming(null);
  }, [open]);

  // Search: titles and previews match at once; line text from the API a moment later.
  const q = query.trim().toLowerCase();
  useEffect(() => {
    setFound(null);
    if (!q) return;
    const t = setTimeout(async () => {
      const res = await listThreads(q);
      if (res.ok) setFound(res.data);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const local = q
    ? threads.filter((t) => t.title.toLowerCase().includes(q) || t.preview?.toLowerCase().includes(q))
    : threads;
  const deletedIds = new Set(deleting);
  const shown = q && found ? found : local;
  const pinned = shown.filter((t) => t.pinned);
  const recent = shown.filter((t) => !t.pinned);

  function choose(t: ChatThread) {
    if (revealed) {
      setRevealed(null);
      return;
    }
    void openThread(t.id, { fromProps: t.id === serverKey });
    onClose();
  }

  const group = (label: string, list: ChatThread[]) =>
    list.length ? (
      <section className="mt-5 first:mt-3">
        <h3 className="px-4 pb-1.5 text-footnote font-semibold text-label-2">{label}</h3>
        <ul className="overflow-hidden rounded-group bg-fill">
          {list.map((t, i) => (
            <li key={t.id} className="relative">
              {i > 0 ? <span className="absolute inset-x-0 top-0 z-10 ml-4 h-[0.5px] bg-separator" /> : null}
              {deletedIds.has(t.id) ? (
                <div role="status" className="m-swap flex min-h-[84px] items-center gap-3 px-4">
                  <p className="min-w-0 flex-1 truncate text-subhead text-label-2">Deleted “{t.title}”.</p>
                  <button
                    type="button"
                    onClick={() => undoDelete(t.id)}
                    className="press min-h-9 shrink-0 px-1 text-subhead font-semibold text-tint-text"
                  >
                    Undo
                  </button>
                </div>
              ) : renaming === t.id ? (
                <RenameRow
                  thread={t}
                  onDone={(title) => {
                    setRenaming(null);
                    if (title && title !== t.title) void editThread(t.id, { title }, threads);
                  }}
                />
              ) : (
                <ThreadRow
                  thread={t}
                  current={t.id === currentKey}
                  revealed={revealed === t.id}
                  onReveal={(on) => setRevealed(on ? t.id : null)}
                  onOpen={() => choose(t)}
                  onRename={() => {
                    setRevealed(null);
                    setRenaming(t.id);
                  }}
                  onPin={() => {
                    setRevealed(null);
                    void editThread(t.id, { pinned: !t.pinned }, threads);
                  }}
                  onDelete={() => {
                    setRevealed(null);
                    deleteThread(t.id, threads, serverKey);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Conversations"
      trailing={
        <button
          type="button"
          onClick={onNew}
          className="press -mr-2 h-11 px-2 text-body font-semibold text-tint-text"
        >
          New
        </button>
      }
    >
      <label className="m-field flex min-h-10 items-center gap-2 rounded-block bg-fill px-3">
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0 text-label-2">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="sr-only">Search conversations</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          enterKeyHint="search"
          maxLength={100}
          className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-label-2"
        />
      </label>
      <p role="alert" className="min-h-0 px-1 text-footnote text-danger empty:hidden">
        {listError ? <span className="mt-2 block">{listError}</span> : null}
      </p>
      {shown.length === 0 ? (
        <p className="px-4 pt-8 pb-4 text-center text-subhead text-label-2">
          {q
            ? `No conversation mentions “${query.trim()}”.`
            : "No conversations yet. Ask me anything about your day."}
        </p>
      ) : (
        <>
          {group("Pinned", pinned)}
          {group(pinned.length ? "Recent" : "All conversations", recent)}
        </>
      )}
      <p className="px-4 pt-4 text-footnote text-label-2">
        Each conversation keeps its own lines. I remember what matters across them.
      </p>
    </Sheet>
  );
}

function ThreadRow({
  thread,
  current,
  revealed,
  onReveal,
  onOpen,
  onRename,
  onPin,
  onDelete,
}: {
  thread: ChatThread;
  current: boolean;
  revealed: boolean;
  onReveal: (on: boolean) => void;
  onOpen: () => void;
  onRename: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const face = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; dx: number; horizontal: boolean | null } | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  // The actions stay hidden while the row rests shut, so no colour shows at its rounded corners.
  const [moving, setMoving] = useState(false);
  const when = thread.last_message_at ?? thread.created_at;

  // The face rests open or shut; while dragging it follows the finger without a transition.
  const rest = revealed ? -TRAY : 0;
  const lastRest = useRef(rest);
  useEffect(() => {
    const el = face.current;
    if (!el || drag.current) return;
    el.style.transition = reducedMotion() ? "none" : "";
    el.style.transform = `translateX(${rest}px)`;
    const was = lastRest.current;
    lastRest.current = rest;
    if (rest !== 0 || was === 0) return;
    // Shutting: keep the actions under the face until it has slid home.
    setMoving(true);
    const t = setTimeout(() => setMoving(false), reducedMotion() ? 0 : motionMs("--m-dur-smooth", 430));
    return () => clearTimeout(t);
  }, [rest]);

  const clearPress = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, horizontal: null };
    longPressed.current = false;
    clearPress();
    press.current = setTimeout(() => {
      longPressed.current = true;
      drag.current = null;
      onReveal(true);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: PointerEvent) => {
    const s = drag.current;
    const el = face.current;
    if (!s || !el) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) clearPress();
    if (s.horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      s.horizontal = Math.abs(dx) > Math.abs(dy);
      if (s.horizontal) {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setMoving(true);
      }
    }
    if (!s.horizontal) return;
    s.dx = dx;
    const x = Math.min(0, Math.max(-TRAY - 24, rest + dx));
    el.style.transition = "none";
    el.style.transform = `translateX(${x}px)`;
  };
  const onPointerUp = () => {
    clearPress();
    const s = drag.current;
    drag.current = null;
    const el = face.current;
    if (!s || !el || !s.horizontal) return;
    el.style.transition = reducedMotion() ? "none" : "";
    const x = rest + s.dx;
    const next = x < -OPEN_AT;
    el.style.transform = `translateX(${next ? -TRAY : 0}px)`;
    if (next !== revealed) onReveal(next);
    // Let go shut without a change of state: hide the actions once the face is home.
    else if (!next) setTimeout(() => setMoving(false), reducedMotion() ? 0 : motionMs("--m-dur-smooth", 430));
  };

  return (
    <div className="relative overflow-hidden">
      <div
        className={`absolute inset-y-0 right-0 flex ${revealed || moving ? "" : "invisible"}`}
        style={{ width: TRAY }}
        aria-hidden={!revealed}
      >
        <TrayButton
          label="Rename"
          onClick={onRename}
          tabIndex={revealed ? 0 : -1}
          className="bg-label-2 text-bg"
        />
        <TrayButton
          label={thread.pinned ? "Unpin" : "Pin"}
          onClick={onPin}
          tabIndex={revealed ? 0 : -1}
          className="bg-tint text-on-tint"
        />
        <TrayButton
          label="Delete"
          onClick={onDelete}
          tabIndex={revealed ? 0 : -1}
          className="bg-danger text-on-tint"
        />
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: swipe and long press are shortcuts; the More button gives the same actions to keyboards and screen readers */}
      <div
        ref={face}
        className="m-thread-face relative flex touch-pan-y items-stretch bg-fill"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => {
          e.preventDefault();
          onReveal(true);
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (longPressed.current) {
              longPressed.current = false;
              return;
            }
            onOpen();
          }}
          aria-current={current ? "true" : undefined}
          className="min-w-0 flex-1 py-2.5 pl-4 text-left active:bg-[color-mix(in_srgb,var(--m-label)_6%,transparent)]"
        >
          <span className="flex items-baseline gap-2">
            <span
              className={`min-w-0 flex-1 truncate text-body font-semibold ${current ? "text-tint-text" : ""}`}
            >
              {thread.title}
            </span>
            <span className="shrink-0 text-footnote text-label-2 tnum">{formatWhen(when)}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 min-h-[2lh] text-subhead text-label-2">
            {thread.preview ?? "No lines yet."}
          </span>
        </button>
        <button
          type="button"
          aria-label={`More for ${thread.title}`}
          aria-expanded={revealed}
          onClick={() => onReveal(!revealed)}
          className="press grid w-11 shrink-0 place-items-center text-label-2"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
            <circle cx="3" cy="8" r="1.4" fill="currentColor" />
            <circle cx="8" cy="8" r="1.4" fill="currentColor" />
            <circle cx="13" cy="8" r="1.4" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function TrayButton({
  label,
  onClick,
  className,
  tabIndex,
}: {
  label: string;
  onClick: () => void;
  className: string;
  tabIndex: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={tabIndex}
      className={`flex-1 text-footnote font-semibold active:opacity-70 ${className}`}
    >
      {label}
    </button>
  );
}

function RenameRow({ thread, onDone }: { thread: ChatThread; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(thread.title);
  const done = useRef(false);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(title);
  };
  return (
    <form
      className="flex min-h-[84px] items-center gap-2 px-4"
      onSubmit={(e) => {
        e.preventDefault();
        finish(value.trim().slice(0, 80) || null);
      }}
    >
      <label className="sr-only" htmlFor={`rename-${thread.id}`}>
        Name this conversation
      </label>
      <input
        id={`rename-${thread.id}`}
        // biome-ignore lint/a11y/noAutofocus: the user just asked to rename this row
        autoFocus
        value={value}
        maxLength={80}
        enterKeyHint="done"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(null);
          }
        }}
        onBlur={() => finish(value.trim().slice(0, 80) || null)}
        className="min-w-0 flex-1 bg-transparent text-body font-semibold outline-none"
      />
      <button type="submit" className="press min-h-9 shrink-0 px-1 text-subhead font-semibold text-tint-text">
        Save
      </button>
    </form>
  );
}
