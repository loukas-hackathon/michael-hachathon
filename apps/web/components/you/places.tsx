"use client";

import type { Place, PlaceInput } from "@michael/shared";
import { useActionState, useEffect, useId, useState } from "react";
import { type FormState, savePlaces } from "@/app/you/places-actions";
import { input, Row } from "../form-controls";
import { Sheet } from "../sheet";

const SLOTS = [
  { key: "home", label: "Home", placeholder: "Street and number, area" },
  { key: "work", label: "Work", placeholder: "Office address" },
  { key: "gym", label: "Gym", placeholder: "Gym or pool" },
] as const;

const initial: FormState = { ok: false, message: null };

function PlacesForm({ places, formId, onDone }: { places: Place[]; formId: string; onDone: () => void }) {
  const keep: PlaceInput[] = places
    .filter((p) => p.address || (p.lat != null && p.lng != null))
    .map((p) => ({ key: p.key, label: p.label, address: p.address, lat: p.lat, lng: p.lng }));
  const [state, action] = useActionState(savePlaces.bind(null, keep), initial);
  const uid = useId();
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form id={formId} action={action} className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-group bg-fill">
        {SLOTS.map((s) => (
          <Row key={s.key} label={s.label} htmlFor={`${uid}-${s.key}`}>
            <input
              id={`${uid}-${s.key}`}
              name={s.key}
              defaultValue={places.find((p) => p.key === s.key)?.address ?? ""}
              placeholder={s.placeholder}
              autoComplete="street-address"
              maxLength={300}
              className={input}
            />
          </Row>
        ))}
      </div>
      <p className="px-4 text-footnote text-label-2">
        I use these to plan your drives around traffic. Leave one empty to remove it.
      </p>
      {state.message && !state.ok ? (
        <p role="alert" className="px-1 text-subhead text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** Places under You > Sources (#157): home, work and gym; empty state "Add home and gym". */
export function Places({
  places,
  mapsAvailable,
  travelEnabled,
}: {
  places: Place[];
  mapsAvailable: boolean;
  travelEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const shown = places.filter((p) => SLOTS.some((s) => s.key === p.key));

  return (
    <div className="mb-4">
      <div className="overflow-hidden rounded-group bg-fill">
        {shown.length === 0 ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="press flex min-h-14 w-full items-center gap-2 px-4 text-left"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px] text-tint-text">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            <span className="flex flex-col">
              <span className="text-body text-tint-text">Add home and gym</span>
              <span className="text-footnote text-label-2">So I can plan your drives around traffic</span>
            </span>
          </button>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="press block w-full text-left">
            {SLOTS.map((s, i) => {
              const p = shown.find((x) => x.key === s.key);
              return (
                <span
                  key={s.key}
                  className="relative flex min-h-11 items-center justify-between gap-3 px-4 py-2"
                >
                  {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
                  <span className="text-body">{s.label}</span>
                  <span className={`truncate text-subhead ${p ? "text-label-2" : "text-tint-text"}`}>
                    {p?.address ?? (p ? "Set" : "Add")}
                  </span>
                </span>
              );
            })}
          </button>
        )}
      </div>
      {shown.length > 0 && (!mapsAvailable || !travelEnabled) ? (
        <p className="mt-2 px-4 text-footnote text-label-2">
          {!mapsAvailable
            ? "Travel times start once maps are switched on on our side."
            : "Switch on Travel times below and I plan around traffic."}
        </p>
      ) : null}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Places"
        trailing={
          <button
            type="submit"
            form={formId}
            className="press -mr-2 h-11 px-2 text-body font-semibold text-tint-text"
          >
            Save
          </button>
        }
      >
        <PlacesForm places={places} formId={formId} onDone={() => setOpen(false)} />
      </Sheet>
    </div>
  );
}
