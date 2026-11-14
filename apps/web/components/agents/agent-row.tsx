"use client";

import { useState } from "react";

type Scope = { key: string; label: string; on: boolean };

/**
 * An allowed agent: tap to see what it may read, switch scopes, or revoke it.
 * Local state until PATCH /v1/agents/:id is live.
 */
export function AgentRow({
  name,
  lastAsked,
  scopes,
}: {
  name: string;
  lastAsked: string | null;
  scopes: Scope[];
}) {
  const [state, setState] = useState(scopes);
  const [revoked, setRevoked] = useState(false);
  const shared = state.filter((s) => s.on).map((s) => s.label);

  return (
    <details className="group">
      <summary className="press flex min-h-[60px] cursor-pointer list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="grid size-[34px] shrink-0 place-items-center rounded-[9px] bg-context text-subhead font-bold"
        >
          {name.slice(0, 1)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body font-semibold">{name}</span>
          <span className="truncate text-footnote text-label-2 tnum">
            {revoked
              ? "Revoked. Sees nothing."
              : `${shared.length ? shared.join(", ") : "Nothing shared"}${lastAsked ? `. Last asked ${lastAsked}` : ""}`}
          </span>
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-4 shrink-0 text-label-2 transition-transform duration-200 group-open:rotate-90"
        >
          <path
            d="m9 5 7 7-7 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      {revoked ? null : (
        <div className="px-4 pb-3">
          <ul className="overflow-hidden rounded-group bg-bg">
            {state.map((s, i) => (
              <li key={s.key} className="relative">
                {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
                <label
                  htmlFor={`${name}-${s.key}`}
                  className="flex min-h-11 items-center justify-between gap-3 px-4"
                >
                  <span className="text-subhead">{s.label}</span>
                  <input
                    id={`${name}-${s.key}`}
                    type="checkbox"
                    className="m-switch shrink-0"
                    checked={s.on}
                    onChange={(e) =>
                      setState((prev) =>
                        prev.map((x) => (x.key === s.key ? { ...x, on: e.target.checked } : x)),
                      )
                    }
                  />
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setRevoked(true)}
            className="press mt-2 min-h-11 px-0 text-subhead font-semibold text-danger"
          >
            Revoke {name}
          </button>
        </div>
      )}
    </details>
  );
}
