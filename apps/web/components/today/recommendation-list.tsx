"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatTime } from "@/lib/format";
import {
  dismissRecommendationAction,
  doRecommendation,
  type RecActionResult,
  undoRecommendationAction,
} from "@/lib/recommendation-actions";
import type { RecCard, TravelDriveRow } from "@/lib/recommendations";
import { DriveBar } from "./travel-card";

type Op = "do" | "undo" | "dismiss";
type Local = { status?: RecCard["status"]; busy?: Op; error?: string; note?: string; hidden?: boolean };

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

/** The drives a travel suggestion changes: now, then with Michael's plan. Extra minutes hatched. */
function Drives({ drives }: { drives: TravelDriveRow[] }) {
  const scale = Math.max(...drives.flatMap((d) => [d.before.minutes, d.after.minutes]), 1);
  return (
    <ul className="mt-1 flex flex-col gap-2.5">
      {drives.slice(0, 4).map((d) => {
        const least = Math.min(d.before.minutes, d.after.minutes);
        return (
          <li key={`${d.to}-${d.before.at}`} className="flex flex-col gap-1">
            <p className="text-footnote text-label-2">To {d.to}</p>
            <DriveBar
              at={d.before.at}
              minutes={d.before.minutes}
              traffic={d.before.minutes - least}
              scale={scale}
            />
            <DriveBar
              at={d.after.at}
              minutes={d.after.minutes}
              traffic={d.after.minutes - least}
              scale={scale}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** One suggestion: what, why, the maths, and one tap to do it or put it aside. Feedback stays in place. */
function Card({ card, local, act }: { card: RecCard; local: Local; act: (op: Op) => void }) {
  const status = local.status ?? card.status;
  const done = status === "done";
  const canUndo = done && (card.undoUntil === null || Date.parse(card.undoUntil) > Date.now());
  const busy = Boolean(local.busy);

  return (
    <li className="flex flex-col gap-1.5 rounded-group bg-fill px-4 pt-3 pb-3.5" aria-busy={busy}>
      {card.when ? <p className="text-footnote font-semibold text-label-2 tnum">{card.when}</p> : null}
      <p className="text-body font-semibold">{/[.!?]$/.test(card.title) ? card.title : `${card.title}.`}</p>
      <p className="text-subhead text-label-2">{card.rationale}</p>
      {card.maths ? <p className="text-subhead font-semibold text-tint-text tnum">{card.maths}</p> : null}
      {card.drives?.length ? <Drives drives={card.drives} /> : null}

      {local.error ? (
        <p role="alert" className="text-subhead text-danger">
          {local.error}
        </p>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        {done ? (
          <>
            <p role="status" className="mr-1 text-subhead text-label tnum">
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
  const patch = (id: string, next: Local) => setLocal((s) => ({ ...s, [id]: next }));

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

  const visible = cards.filter((c) => !local[c.id]?.hidden);
  if (visible.length === 0) return null;
  return (
    <section className="mt-6" aria-label="Michael suggests">
      <h2 className="mb-2 text-title3 font-bold">Michael suggests</h2>
      <ul className="flex flex-col gap-2.5">
        {visible.map((c) => (
          <Card key={c.id} card={c} local={local[c.id] ?? {}} act={(op) => act(c, op)} />
        ))}
      </ul>
    </section>
  );
}
