"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useArrival } from "@/components/motion";
import { formatTime } from "@/lib/format";
import {
  dismissRecommendationAction,
  doRecommendation,
  type RecActionResult,
  undoRecommendationAction,
} from "@/lib/recommendation-actions";
import type { RecCard } from "@/lib/recommendations";

type Op = "do" | "undo" | "dismiss";
// hidden: on its way out (fades and shrinks a touch); removed: gone from the list once that ends.
type Local = {
  status?: RecCard["status"];
  busy?: Op;
  error?: string;
  note?: string;
  hidden?: boolean;
  removed?: boolean;
};

const ACTIONS: Record<Op, (id: string) => Promise<RecActionResult>> = {
  do: doRecommendation,
  undo: undoRecommendationAction,
  dismiss: dismissRecommendationAction,
};
// What the card shows while the server works (optimistic), rolled back if it fails.
const OPTIMISTIC: Record<Op, Partial<Local>> = {
  do: { status: "done" },
  undo: { status: "undone" },
  dismiss: { hidden: true },
};

const filled =
  "press min-h-9 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint disabled:opacity-60";
const tinted =
  "press min-h-9 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text disabled:opacity-60";
const plain = "press min-h-9 rounded-full px-3 text-subhead font-semibold text-tint-text disabled:opacity-60";

/** One suggestion: what, why, the maths, and one tap to do it or put it aside. Feedback stays in place. */
function Card({
  card,
  local,
  act,
  swapped,
  onGone,
}: {
  card: RecCard;
  local: Local;
  act: (op: Op) => void;
  /** True right after the status changed here, so the new line eases in. */
  swapped: (status: string) => boolean;
  onGone: () => void;
}) {
  const status = local.status ?? card.status;
  const done = status === "done";
  const canUndo = done && (card.undoUntil === null || Date.parse(card.undoUntil) > Date.now());
  const busy = Boolean(local.busy);

  return (
    <li
      className={`flex flex-col gap-1.5 rounded-group bg-fill px-4 pt-3 pb-3.5 ${local.hidden ? "m-leave" : ""}`}
      aria-busy={busy}
      aria-hidden={local.hidden || undefined}
      onAnimationEnd={(e) => {
        if (local.hidden && e.target === e.currentTarget) onGone();
      }}
    >
      {card.when ? <p className="text-footnote font-semibold text-label-2 tnum">{card.when}</p> : null}
      <p className="text-body font-semibold">{/[.!?]$/.test(card.title) ? card.title : `${card.title}.`}</p>
      <p className="text-subhead text-label-2">{card.rationale}</p>
      {card.maths ? <p className="text-subhead font-semibold text-tint-text tnum">{card.maths}</p> : null}

      {local.error ? (
        <p role="alert" className="text-subhead text-danger">
          {local.error}
        </p>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        {done ? (
          <>
            <p
              role="status"
              className={`mr-1 text-subhead text-label tnum ${swapped(status) ? "m-swap" : ""}`}
            >
              {canUndo && card.undoUntil ? `Done. Undo until ${formatTime(card.undoUntil)}.` : "Done."}
            </p>
            {canUndo ? (
              <button type="button" className={tinted} disabled={busy} onClick={() => act("undo")}>
                Undo
              </button>
            ) : null}
          </>
        ) : (
          <>
            {local.note ? (
              <p role="status" className="w-full text-subhead text-label-2">
                {local.note}
              </p>
            ) : null}
            {card.executable ? (
              <button type="button" className={filled} disabled={busy} onClick={() => act("do")}>
                Do it
              </button>
            ) : (
              <p className="mr-1 text-footnote text-label-2">
                {card.involvesOthers
                  ? "It has other people in it, so I only advise."
                  : "Advice only. This one is yours to do."}
              </p>
            )}
            <button type="button" className={plain} disabled={busy} onClick={() => act("dismiss")}>
              Not now
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function RecommendationList({ cards }: { cards: RecCard[] }) {
  const router = useRouter();
  const [local, setLocal] = useState<Record<string, Local>>({});
  // A card that already finished leaving stays gone while it is still hidden.
  const patch = (id: string, next: Local) =>
    setLocal((s) => ({ ...s, [id]: { ...next, removed: next.hidden ? s[id]?.removed : undefined } }));

  async function act(card: RecCard, op: Op) {
    const before = local[card.id] ?? {};
    const note = op === "undo" ? { note: card.undoneNote } : {};
    patch(card.id, { ...before, ...OPTIMISTIC[op], ...note, error: undefined, busy: op });
    const r = await ACTIONS[op](card.id).catch(
      (): RecActionResult => ({
        ok: false,
        error: "I could not reach the server. Nothing changed.",
        gone: false,
      }),
    );
    if (r.ok) {
      patch(card.id, { ...OPTIMISTIC[op], ...note, status: r.rec.status, hidden: op === "dismiss" });
      router.refresh();
    } else {
      // Roll back to what the card showed before, with the reason in Michael's words, and read the
      // list again in case it changed elsewhere (another device, Claude).
      patch(card.id, { ...before, busy: undefined, note: undefined, error: r.error, hidden: r.gone });
      router.refresh();
    }
  }

  const arriving = useArrival();
  const visible = cards.filter((c) => !local[c.id]?.removed);
  if (visible.length === 0) return null;
  return (
    <section className="mt-6" aria-label="Michael suggests">
      <h2 className="mb-2 text-title3 font-bold">Michael suggests</h2>
      <ul className="flex flex-col gap-2.5">
        {visible.map((c) => (
          <Card
            key={c.id}
            card={c}
            local={local[c.id] ?? {}}
            act={(op) => act(c, op)}
            swapped={(status) => arriving(`${c.id}:${status}`)}
            onGone={() => setLocal((s) => ({ ...s, [c.id]: { ...s[c.id], removed: true } }))}
          />
        ))}
      </ul>
    </section>
  );
}
