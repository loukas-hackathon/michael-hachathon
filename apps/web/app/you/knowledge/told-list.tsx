"use client";

import type { KnowledgeItem, KnowledgeKind, KnowledgeOrigin } from "@michael/shared";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { haptic } from "@/components/haptics";
import { addMemory, forgetItem } from "./actions";

// "Things you told me" (#379). Forget hides the row at once and shows Undo for five seconds; only
// then does the server really delete it (michael-feedback: deleting is not optimistic, so the
// delete waits out the Undo instead). Leaving the page sends what is waiting straight away.
// The first row of "Things to remember" adds one in the user's own words, like the memory in other
// assistants; the chat reads it into every answer. Not optimistic: the id comes from the server.

export const UNDO_MS = 5000;
const SHOWN = 5;
const MAX_MEMORY = 280;

const GROUPS: [KnowledgeKind, string][] = [
  ["memory", "Things to remember"],
  ["check_in", "Check in answers"],
  ["instruction", "Standing instructions"],
  ["profile", "From your setup"],
];

const ORIGIN: Record<KnowledgeOrigin, string> = {
  chat: "In chat",
  agent: "Through an agent",
  check_in: "Check in",
  you: "Your rule",
  setup: "Setup",
};

const dayFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Athens",
});

/** "In chat, 14 Nov", "Check in, 13 Nov. Paused", "You wrote it, 15 Nov". */
function whereFrom(item: KnowledgeItem): string {
  const when = item.at ? `, ${dayFmt.format(new Date(item.at))}` : "";
  const paused = item.active ? "" : ". Paused";
  const origin = item.kind === "memory" && item.origin === "you" ? "You wrote it" : ORIGIN[item.origin];
  return `${origin}${when}${paused}`;
}

type Waiting = { item: KnowledgeItem; timer: ReturnType<typeof setTimeout> };

/** One line to add a memory by hand. Enter or Add keeps it; the new row appears below. */
function AddMemory({ onAdded }: { onAdded: (item: KnowledgeItem) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = text.trim().length > 0 && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addMemory(text.trim());
      if (res.ok) {
        haptic();
        setText("");
        onAdded(res.item);
      } else {
        setError(res.error);
      }
    } catch {
      setError("I lost the line. Nothing was kept.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="relative">
      <form onSubmit={submit} className="flex min-h-12 items-center gap-2 pl-4 pr-2">
        <label htmlFor="add-memory" className="sr-only">
          Something for me to remember
        </label>
        <input
          id="add-memory"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_MEMORY}
          autoComplete="off"
          enterKeyHint="done"
          placeholder="Add something to remember"
          className="min-h-12 min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-2"
        />
        <button
          type="submit"
          disabled={!ready}
          aria-busy={busy}
          className="press h-11 min-w-16 shrink-0 px-2 text-subhead font-semibold text-tint-text disabled:text-label-2"
        >
          {busy ? "Adding" : "Add"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="px-4 pb-2.5 text-footnote text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function ToldList({ items }: { items: KnowledgeItem[] }) {
  // Rows forgotten on the server (kept hidden until the refreshed list drops them too).
  const [gone, setGone] = useState<Set<string>>(new Set());
  // Rows waiting out their Undo, by id.
  const [waiting, setWaiting] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Set<KnowledgeKind>>(new Set());
  // Memories added on this page, shown at once (the refreshed list then carries them too).
  const [added, setAdded] = useState<KnowledgeItem[]>([]);
  const timers = useRef(new Map<string, Waiting>());

  const key = (i: KnowledgeItem) => `${i.kind}:${i.id}`;

  async function send(item: KnowledgeItem) {
    const k = key(item);
    timers.current.delete(k);
    const res = await forgetItem(item.kind, item.id).catch(() => ({
      ok: false as const,
      error: "I lost the line. It's still here.",
    }));
    setWaiting((w) => w.filter((x) => x !== k));
    if (res.ok) {
      setGone((g) => new Set(g).add(k));
    } else {
      setErrors((e) => ({ ...e, [k]: res.error }));
    }
  }

  function forget(item: KnowledgeItem) {
    const k = key(item);
    if (timers.current.has(k)) return;
    haptic();
    setErrors(({ [k]: _, ...rest }) => rest);
    setWaiting((w) => [...w, k]);
    timers.current.set(k, { item, timer: setTimeout(() => void send(item), UNDO_MS) });
  }

  function undo(item: KnowledgeItem) {
    const k = key(item);
    const w = timers.current.get(k);
    if (w) clearTimeout(w.timer);
    timers.current.delete(k);
    setWaiting((list) => list.filter((x) => x !== k));
  }

  function onAdded(item: KnowledgeItem) {
    const k = key(item);
    // The same words again come back as the memory already kept: bring it back if it was forgotten.
    setGone((g) => {
      if (!g.has(k)) return g;
      const next = new Set(g);
      next.delete(k);
      return next;
    });
    setAdded((a) => [item, ...a.filter((x) => x.id !== item.id)]);
  }

  // Leaving the page (or closing it) never loses a Forget: what is waiting goes now.
  useEffect(() => {
    const map = timers.current;
    const flush = () => {
      for (const w of map.values()) {
        clearTimeout(w.timer);
        void forgetItem(w.item.kind, w.item.id);
      }
      map.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const fresh = new Set(added.map(key));
  const visible = [...added, ...items.filter((i) => !fresh.has(key(i)))].filter((i) => !gone.has(key(i)));

  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map(([kind, label]) => {
        const all = visible.filter((i) => i.kind === kind);
        // The memory group is always there: its first row is where a new one is written.
        if (!all.length && kind !== "memory") return null;
        const list = open.has(kind) ? all : all.slice(0, SHOWN);
        const more = all.length - list.length;
        return (
          <section key={kind} aria-label={label}>
            <h3 className="px-4 pb-1.5 text-footnote font-semibold text-label-2">{label}</h3>
            <ul className="overflow-hidden rounded-group bg-fill">
              {kind === "memory" ? <AddMemory onAdded={onAdded} /> : null}
              {list.map((item, i) => {
                const k = key(item);
                return (
                  <li
                    key={k}
                    className={fresh.has(k) ? "m-live-enter relative" : "relative"}
                    data-knowledge={item.kind}
                  >
                    {i > 0 || kind === "memory" ? (
                      <span className="absolute inset-x-0 top-0 z-10 ml-4 h-[0.5px] bg-separator" />
                    ) : null}
                    {waiting.includes(k) ? (
                      <div role="status" className="m-swap flex min-h-14 items-center gap-3 px-4 py-2">
                        <p className="min-w-0 flex-1 truncate text-subhead text-label-2">Forgotten.</p>
                        <button
                          type="button"
                          onClick={() => undo(item)}
                          className="press h-11 shrink-0 px-2 text-subhead font-semibold text-tint-text"
                        >
                          Undo
                        </button>
                      </div>
                    ) : (
                      <div className="flex min-h-14 items-center gap-3 px-4 py-2">
                        <div className="flex min-w-0 flex-1 flex-col">
                          <p className="text-body">{item.text}</p>
                          {item.answer ? <p className="text-subhead">You said “{item.answer}”</p> : null}
                          {item.kind === "profile" ? null : (
                            <p className="text-footnote text-label-2 tnum">{whereFrom(item)}</p>
                          )}
                          {errors[k] ? (
                            <p role="alert" className="text-footnote text-danger">
                              {errors[k]}
                            </p>
                          ) : null}
                        </div>
                        {item.forgettable ? (
                          <button
                            type="button"
                            onClick={() => forget(item)}
                            aria-label={`Forget: ${item.text}`}
                            className="press -mr-2 h-11 shrink-0 px-2 text-subhead font-semibold text-tint-text"
                          >
                            Forget
                          </button>
                        ) : null}
                      </div>
                    )}
                  </li>
                );
              })}
              {more > 0 ? (
                <li className="relative">
                  <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" />
                  <button
                    type="button"
                    onClick={() => setOpen((o) => new Set(o).add(kind))}
                    className="press flex h-12 w-full items-center px-4 text-subhead font-semibold text-tint-text"
                  >
                    Show {more} more
                  </button>
                </li>
              ) : null}
            </ul>
            {kind === "memory" && !all.length ? (
              <p className="mt-2 px-4 text-footnote text-label-2">
                Or tell me in{" "}
                <Link href="/chat" className="font-semibold text-tint-text">
                  chat
                </Link>
                . I keep what lasts and use it in every answer.
              </p>
            ) : null}
            {kind === "profile" ? (
              <p className="mt-2 px-4 text-footnote text-label-2">
                To change your hours or your week,{" "}
                <Link href="/chat" className="font-semibold text-tint-text">
                  tell me in chat
                </Link>
                .
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
