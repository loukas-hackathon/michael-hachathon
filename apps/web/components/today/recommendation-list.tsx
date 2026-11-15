"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ActionError } from "@/components/action-feedback";
import { FlipList } from "@/components/flip-list";
import { haptic } from "@/components/haptics";
import { useArrival, useDeparting } from "@/components/motion";
import { NudgePrimer } from "@/components/nudge-primer";
import { formatTime } from "@/lib/format";
import {
  dismissRecommendationAction,
  doRecommendation,
  type RecActionResult,
  undoRecommendationAction,
} from "@/lib/recommendation-actions";
import type { RecCard, TravelDriveRow } from "@/lib/recommendations";
import { Fold } from "./fold";
import { DriveBar } from "./travel-card";

type Op = "do" | "undo" | "dismiss";
// hidden: on its way out (fades and shrinks a touch); removed: gone from the list once that ends.
type Local = {
  status?: RecCard["status"];
  busy?: Op;
  error?: string;
  /** The tap that failed, for Try again. */
  failed?: Op;
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
  "hit press min-h-9 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint disabled:opacity-60";
const tinted =
  "hit press min-h-9 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text disabled:opacity-60";
// Not now is grey (#208): only the one primary Do it on Today is filled pink.
const plain =
  "hit press min-h-9 rounded-full px-3 text-subhead font-semibold text-label-2 disabled:opacity-60";

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

/**
 * One suggestion: what, why, the maths, and one tap to do it or put it aside. Feedback stays in place.
 * The primary card carries the screen's one filled Do it; the others use the tinted button.
 */
function Card({
  card,
  local,
  act,
  swapped,
  onGone,
  primary,
}: {
  card: RecCard;
  local: Local;
  act: (op: Op) => void;
  primary: boolean;
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
      className={`flex flex-col gap-1.5 ${
        primary
          ? "rounded-card bg-fill px-4 pt-3.5 pb-4"
          : "relative py-3 not-first:before:absolute not-first:before:inset-x-0 not-first:before:top-0 not-first:before:h-[0.5px] not-first:before:bg-separator not-first:before:content-['']"
      } ${local.hidden ? "m-leave" : ""}`}
      aria-busy={busy}
      aria-hidden={local.hidden || undefined}
      onAnimationEnd={(e) => {
        if (local.hidden && e.target === e.currentTarget) onGone();
      }}
    >
      {card.when ? <p className="text-footnote font-semibold text-label-2 tnum">{card.when}</p> : null}
      <p className="text-body font-semibold">{/[.!?]$/.test(card.title) ? card.title : `${card.title}.`}</p>
      <p className="text-subhead text-label-2">{card.rationale}</p>
      {card.maths ? <p className="text-subhead font-semibold text-label tnum">{card.maths}</p> : null}
      {card.drives?.length ? <Drives drives={card.drives} /> : null}

      <ActionError
        error={local.error ?? null}
        onRetry={local.failed && !local.hidden ? () => act(local.failed as Op) : undefined}
        className="text-subhead"
      />

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
              <button
                type="button"
                className={primary ? filled : tinted}
                disabled={busy}
                onClick={() => act("do")}
              >
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

// The next move the person just acted on stays the next move after the page reads the list again
// (the server action revalidates Today), so "Done. Undo until 09:30." reads where the tap was instead
// of the next suggestion sliding under the thumb. The folded list skips the pinned card and takes
// the suggestion the server now puts first.
type Pin = { id: string | null; displaced: RecCard | null };
const NO_PIN: Pin = { id: null, displaced: null };
let pin: Pin = NO_PIN;
const listeners = new Set<() => void>();
function setPin(next: Pin) {
  if (next.id === pin.id && next.displaced?.id === pin.displaced?.id) return;
  pin = next;
  for (const l of listeners) l();
}
function subscribePin(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const readPin = () => pin;
const readNoPin = () => NO_PIN;

/**
 * `primary`: "Your next move", the one thing to do now, under the score. `rest`: the other
 * suggestions folded into one quiet row under "More from Michael".
 */
export function RecommendationList({ cards, variant }: { cards: RecCard[]; variant: "primary" | "rest" }) {
  const router = useRouter();
  const [local, setLocal] = useState<Record<string, Local>>({});
  const [pinned, setPinned] = useState<RecCard | null>(null);
  // The first Do it is when a buzz helps: ask for nudges then, never on load (#207).
  const [primed, setPrimed] = useState(false);
  const pinNow = useSyncExternalStore(subscribePin, readPin, readNoPin);
  // A card that already finished leaving stays gone while it is still hidden.
  const patch = (id: string, next: Local) =>
    setLocal((s) => ({ ...s, [id]: { ...next, removed: next.hidden ? s[id]?.removed : undefined } }));

  async function act(card: RecCard, op: Op) {
    if (variant === "primary") {
      const keep = op === "dismiss" ? null : card;
      setPinned(keep);
      setPin(keep ? { id: keep.id, displaced: null } : NO_PIN);
    }
    const before = local[card.id] ?? {};
    // A second tap while the first is still with the server does nothing.
    if (before.busy) return;
    const note = op === "undo" ? { note: card.undoneNote } : {};
    patch(card.id, { ...before, ...OPTIMISTIC[op], ...note, error: undefined, failed: undefined, busy: op });
    const r = await ACTIONS[op](card.id).catch(
      (): RecActionResult => ({
        ok: false,
        error: "I could not reach the server. Nothing changed.",
        gone: false,
      }),
    );
    if (r.ok) {
      haptic();
      if (op === "do") setPrimed(true);
      patch(card.id, { ...OPTIMISTIC[op], ...note, status: r.rec.status, hidden: op === "dismiss" });
      router.refresh();
    } else {
      // Roll back to what the card showed before, with the reason in Michael's words, and read the
      // list again in case it changed elsewhere (another device, Claude).
      patch(card.id, {
        ...before,
        busy: undefined,
        note: undefined,
        error: r.error,
        failed: op,
        hidden: r.gone,
      });
      router.refresh();
    }
  }

  // Hand the folded list whatever the server now puts first instead of the pinned card.
  const displaced = variant === "primary" && pinned && cards[0]?.id !== pinned.id ? (cards[0] ?? null) : null;
  useEffect(() => {
    if (variant === "primary" && pinned) setPin({ id: pinned.id, displaced });
  }, [variant, pinned, displaced]);

  const arriving = useArrival();
  const shown =
    variant === "primary"
      ? pinned
        ? [cards.find((c) => c.id === pinned.id) ?? pinned]
        : cards
      : [
          ...(pinNow.displaced && !cards.some((c) => c.id === pinNow.displaced?.id)
            ? [pinNow.displaced]
            : []),
          ...cards.filter((c) => c.id !== pinNow.id),
        ];
  // A dismissed card stays in its place while it fades, even once the refresh has dropped it, so
  // the refresh never cuts the fade short and the gap closes once (FlipList) when it ends.
  const kept = useDeparting(
    shown,
    (c) => c.id,
    (id) => Boolean(local[id]?.hidden && !local[id]?.removed),
  );
  const visible = kept.filter((c) => !local[c.id]?.removed);
  // The cards below slide up into the gap a dismissed card leaves.
  const flipKey = visible.map((c) => c.id).join();
  if (visible.length === 0) return null;
  const items = visible.map((c) => (
    <Card
      key={c.id}
      card={c}
      local={local[c.id] ?? {}}
      act={(op) => act(c, op)}
      swapped={(status) => arriving(`${c.id}:${status}`)}
      onGone={() => setLocal((s) => ({ ...s, [c.id]: { ...s[c.id], removed: true } }))}
      primary={variant === "primary"}
    />
  ));

  if (variant === "primary") {
    return (
      <section className="mt-6" aria-label="Your next move">
        <h2 className="mb-2 text-title3 font-bold">Your next move</h2>
        <FlipList flipKey={flipKey}>{items}</FlipList>
        {primed ? <NudgePrimer /> : null}
      </section>
    );
  }
  const n = visible.length;
  return (
    <Fold
      title={n === 1 ? "One more suggestion" : `${n} more suggestions`}
      label="More suggestions"
      preview={visible.map((c) => c.title.replace(/[.!?]$/, "")).join(". ")}
    >
      <FlipList flipKey={flipKey} className="-mt-1 flex flex-col">
        {items}
      </FlipList>
      {primed ? <NudgePrimer /> : null}
    </Fold>
  );
}
