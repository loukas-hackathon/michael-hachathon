"use client";

import type { AgentScope } from "@michael/shared";
import { useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import { saveAgent } from "@/lib/agents-actions";

export type ScopeSwitch = { key: AgentScope; short: string; title: string; detail: string; on: boolean };

/**
 * An allowed agent as one row: what it can do and when it last asked. Tapping opens a sheet with
 * each scope as a plain language switch and Revoke, which asks once before it acts
 * (PATCH /v1/agents/:id). Every change is optimistic and rolls back with a line if it fails.
 */
export function AgentRow({
  id,
  name,
  since,
  lastAsked,
  scopes,
}: {
  id: string;
  name: string;
  since: string;
  lastAsked: string | null;
  scopes: ScopeSwitch[];
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(scopes);
  const [confirming, setConfirming] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [failed, setFailed] = useState(false);
  const shared = state.filter((s) => s.on).map((s) => s.short);

  // Latest tap wins: each save carries the whole set, and only the newest one may roll back, to
  // the last set the server confirmed. An older save failing never undoes a newer switch.
  const saved = useRef(scopes);
  const seq = useRef(0);
  const confirmed = useRef(0);
  function toggle(key: AgentScope, on: boolean) {
    const next = state.map((x) => (x.key === key ? { ...x, on } : x));
    setState(next);
    setFailed(false);
    const mine = ++seq.current;
    saveAgent(id, { scopes: next.filter((s) => s.on).map((s) => s.key) }).then(
      () => {
        if (mine < confirmed.current) return;
        confirmed.current = mine;
        saved.current = next;
      },
      () => {
        if (mine !== seq.current) return;
        setState(saved.current);
        setFailed(true);
      },
    );
  }

  function revoke() {
    setRevoked(true);
    setConfirming(false);
    setFailed(false);
    saveAgent(id, { status: "revoked" }).catch(() => {
      setRevoked(false);
      setFailed(true);
    });
  }

  const subline = failed
    ? "I could not save that. Try again."
    : revoked
      ? "Revoked. Sees nothing."
      : shared.length
        ? shared.join(", ")
        : "Sees nothing yet";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="press flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <span
          aria-hidden="true"
          className="grid size-[34px] shrink-0 place-items-center rounded-[9px] bg-context text-subhead font-bold"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-body font-semibold">{name}</span>
            {lastAsked && !revoked ? (
              <span className="shrink-0 text-footnote text-label-2 tnum">Last asked {lastAsked}</span>
            ) : null}
          </span>
          <span className={`truncate text-footnote ${failed ? "text-danger" : "text-label-2"}`}>
            {subline}
          </span>
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0 text-label-2">
          <path
            d="m9 5 7 7-7 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          setConfirming(false);
        }}
        title={name}
        trailing={
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="press -mr-2 h-11 px-2 text-body font-semibold text-tint-text"
          >
            Done
          </button>
        }
      >
        <p className="text-subhead text-label-2 tnum">
          Connected since {since}.{lastAsked ? ` Last asked ${lastAsked}.` : ""}
        </p>

        {revoked ? (
          <p role="status" className="m-swap mt-5 rounded-group bg-fill px-4 py-3 text-subhead">
            Revoked. {name} sees nothing from now on. To use it again, connect it again.
          </p>
        ) : (
          <>
            <h3 className="mt-5 mb-2 text-title3 font-bold">What {name} can do</h3>
            <ul className="overflow-hidden rounded-group bg-fill">
              {state.map((s, i) => (
                <li key={s.key} className="relative">
                  {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
                  <label
                    htmlFor={`${id}-${s.key}`}
                    className="flex min-h-11 items-center justify-between gap-3 px-4 py-[11px]"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-body">{s.title}</span>
                      <span className="text-footnote text-label-2">{s.detail}</span>
                    </span>
                    <input
                      id={`${id}-${s.key}`}
                      type="checkbox"
                      className="m-switch shrink-0"
                      checked={s.on}
                      onChange={(e) => toggle(s.key, e.target.checked)}
                    />
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-2 px-4 text-footnote text-label-2">
              {failed ? (
                <span className="text-danger">I could not save that. Try again.</span>
              ) : (
                "Changes apply at once, even mid conversation."
              )}
            </p>

            {confirming ? (
              <div
                role="alertdialog"
                aria-label={`Revoke ${name}?`}
                className="m-swap mt-6 rounded-group bg-fill px-4 py-3.5"
              >
                <p className="text-body font-semibold">Revoke {name}?</p>
                <p className="mt-0.5 text-subhead text-label-2">
                  It stops seeing anything at once and its link stops working. What it booked stays, and you
                  can still undo it.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={revoke}
                    className="hit press min-h-9 rounded-full bg-bg px-4 text-subhead font-semibold text-label"
                  >
                    Revoke {name}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="hit press min-h-9 rounded-full px-3 text-subhead font-semibold text-tint-text"
                  >
                    Keep
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="press mt-6 min-h-11 w-full rounded-group bg-fill px-4 text-left text-body font-semibold text-label"
              >
                Revoke {name}
              </button>
            )}
          </>
        )}
      </Sheet>
    </>
  );
}
