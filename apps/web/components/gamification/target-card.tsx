"use client";

import { useState, useTransition } from "react";
import { acceptTarget, setTarget } from "@/app/goals/target-actions";
import { CATEGORY_TITLE } from "@/lib/categories";
import {
  AREA_ORDER,
  type Baseline,
  type MaybeAreas,
  targetLine,
  type WeeklyTarget,
} from "@/lib/gamification";
import { MiMark } from "../brand";
import { Sheet } from "../sheet";

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const btn =
    "press grid size-11 place-items-center rounded-full bg-bg text-title3 font-semibold text-tint-text disabled:opacity-40";
  return (
    <div className="relative flex min-h-14 items-center justify-between gap-3 px-4 [&+&]:before:absolute [&+&]:before:inset-x-0 [&+&]:before:top-0 [&+&]:before:ml-4 [&+&]:before:h-[0.5px] [&+&]:before:bg-separator [&+&]:before:content-['']">
      <span className="text-body">{label}</span>
      <span className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`${label} lower`}
          disabled={value <= 30}
          onClick={() => onChange(value - 1)}
          className={btn}
        >
          −
        </button>
        <output className="w-12 text-center text-title3 font-semibold tnum" aria-live="polite">
          {value}%
        </output>
        <button
          type="button"
          aria-label={`${label} higher`}
          disabled={value >= 100}
          onClick={() => onChange(value + 1)}
          className={btn}
        >
          +
        </button>
      </span>
    </div>
  );
}

/**
 * Next week's target (#165, #168). Monday: Michael's proposal with the maths, Accept or Edit.
 * In force: one quiet line. Before two weeks of data: the baseline in progress.
 * Local state until the targets endpoint lands (POST is part of #165).
 */
export function TargetCard({ target, baseline }: { target: WeeklyTarget | null; baseline: Baseline | null }) {
  const [t, setT] = useState(target);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ overall: number; areas: MaybeAreas } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  if (!t) {
    if (!baseline) return null;
    return (
      <section className="flex flex-col gap-1.5 rounded-card bg-fill px-4 pt-3.5 pb-4">
        {baseline.reason ? (
          <p className="text-body">{baseline.reason}</p>
        ) : (
          <>
            <p className="text-body font-semibold">Your target comes after two full weeks.</p>
            <p className="text-subhead text-label-2 tnum">
              {baseline.weeksDone} of {baseline.weeksNeeded} done. I'm learning your usual week first.
            </p>
          </>
        )}
      </section>
    );
  }

  if (t.status !== "proposed") {
    return (
      <p className="text-subhead text-label-2 tnum">
        This week's target <b className="font-semibold text-label">{t.overall}%</b>, set by{" "}
        {t.setBy === "michael" ? "Michael" : "you"}.{t.reason ? ` ${t.reason}` : ""}
      </p>
    );
  }

  const open = () => {
    setDraft({ overall: t.overall, areas: { ...t.areas } });
    setEditing(true);
  };

  return (
    <section
      aria-label="Next week's target"
      className="flex flex-col gap-3 rounded-card bg-fill px-4 pt-3.5 pb-4"
    >
      <header className="flex items-center gap-2 text-footnote font-semibold">
        <span className="grid size-[22px] place-items-center rounded-full bg-label text-bg">
          <span className="block w-[13px]">
            <MiMark className="block h-auto w-full" />
          </span>
        </span>
        Michael
      </header>
      <p className="text-insight tracking-[-0.01em] tnum">{targetLine(t)}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            const before = t;
            setT({ ...t, status: "accepted" });
            if (t.weekStart) {
              const week = t.weekStart;
              start(async () => {
                const r = await acceptTarget(week);
                if (!r.ok) {
                  setT(before);
                  setError(r.message);
                }
              });
            }
          }}
          className="press min-h-9 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={open}
          className="press min-h-9 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text"
        >
          Edit
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-subhead text-danger">
          {error}
        </p>
      ) : null}

      <Sheet
        open={editing}
        onClose={() => setEditing(false)}
        title="Next week's target"
        trailing={
          <button
            type="button"
            onClick={() => {
              if (draft) {
                const before = t;
                setT({ ...t, ...draft, status: "edited", setBy: "user" });
                if (t.weekStart) {
                  const week = t.weekStart;
                  start(async () => {
                    const r = await setTarget(week, draft.overall, draft.areas);
                    if (!r.ok) {
                      setT(before);
                      setError(r.message);
                    }
                  });
                }
              }
              setEditing(false);
            }}
            className="press -mr-2 h-11 px-2 text-body font-semibold text-tint-text"
          >
            Save
          </button>
        }
      >
        {draft ? (
          <div className="flex flex-col gap-2">
            <div className="overflow-hidden rounded-group bg-fill">
              <Stepper
                label="Overall"
                value={draft.overall}
                onChange={(v) => setDraft({ ...draft, overall: v })}
              />
              {AREA_ORDER.filter((a) => draft.areas[a] != null).map((a) => (
                <Stepper
                  key={a}
                  label={CATEGORY_TITLE[a]}
                  value={draft.areas[a] as number}
                  onChange={(v) => setDraft({ ...draft, areas: { ...draft.areas, [a]: v } })}
                />
              ))}
            </div>
            <p className="px-4 text-footnote text-label-2 tnum">Your usual week is {t.median}%.</p>
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}
