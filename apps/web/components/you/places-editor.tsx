"use client";

import type { AddressMatch, Place, PlaceInput, PlaceSuggestion } from "@michael/shared";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { findAddress, savePlaceList } from "@/app/you/places/actions";
import { PendingButton } from "@/components/action-feedback";
import { saveSource } from "@/lib/privacy-actions";

const SLOTS = [
  { key: "home", label: "Home", placeholder: "Search your street" },
  { key: "work", label: "Work", placeholder: "Search your office" },
  { key: "gym", label: "Gym", placeholder: "Search your gym or pool" },
  { key: "university", label: "University", placeholder: "Search your campus" },
] as const;
type SlotKey = (typeof SLOTS)[number]["key"];
/** The save in flight, so the right button says what it is doing. */
type Pending = { key: SlotKey; op: "save" | "remove" } | null;

const toInput = (p: Place): PlaceInput => ({
  key: p.key,
  label: p.label,
  address: p.address,
  lat: p.lat,
  lng: p.lng,
});

/** One tap: the phone's own location becomes this place. Safari asks once; nothing else to set up. */
function HereButton({
  slot,
  busy,
  onSave,
}: {
  slot: (typeof SLOTS)[number];
  busy: boolean;
  onSave: (p: PlaceInput) => void;
}) {
  const [state, setState] = useState<"idle" | "finding" | "denied" | "failed">("idle");
  // Checked once mounted: Node 21+ has a `navigator` without geolocation, so a check during render
  // left the button out of the server HTML and failed hydration on the Location page (React #418).
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported("geolocation" in navigator), []);
  if (!supported) return null;
  function locate() {
    setState("finding");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState("idle");
        onSave({
          key: slot.key,
          label: slot.label,
          lat: Math.round(pos.coords.latitude * 1e5) / 1e5,
          lng: Math.round(pos.coords.longitude * 1e5) / 1e5,
        });
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? "denied" : "failed"),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy || state === "finding"}
        onClick={locate}
        className="press flex min-h-11 items-center gap-2 text-left text-subhead font-semibold text-tint-text disabled:opacity-60"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px]" fill="currentColor">
          <path d="M21 3 3 10.5l7.2 2.3L12.5 20z" />
        </svg>
        {state === "finding" ? "Finding you" : `I am at ${slot.label.toLowerCase()} now`}
      </button>
      {state === "denied" ? (
        <p role="alert" className="text-footnote text-label-2">
          Location is off for Michael. Allow it in Settings, Safari, Location, or type the address.
        </p>
      ) : state === "failed" ? (
        <p role="alert" className="text-footnote text-label-2">
          I couldn't find you. Try again outside, or type the address.
        </p>
      ) : null}
    </div>
  );
}

/** One place: tap to search, pick a match and it is saved. Without maps, the typed address is kept. */
function SlotRow({
  slot,
  place,
  open,
  mapsAvailable,
  onOpen,
  onSave,
  busy,
  pending,
}: {
  slot: (typeof SLOTS)[number];
  place: Place | undefined;
  open: boolean;
  mapsAvailable: boolean;
  onOpen: (open: boolean) => void;
  onSave: (p: PlaceInput | null) => void;
  busy: boolean;
  /** What this row is saving right now, if anything. */
  pending: "save" | "remove" | null;
}) {
  const id = useId();
  const [q, setQ] = useState(place?.address ?? "");
  const [results, setResults] = useState<AddressMatch[]>([]);
  const [state, setState] = useState<"idle" | "searching" | "none" | "error">("idle");
  const seq = useRef(0);

  useEffect(() => {
    if (!open || !mapsAvailable) return;
    const query = q.trim();
    if (query.length < 3 || query === place?.address) {
      setResults([]);
      setState("idle");
      return;
    }
    const n = ++seq.current;
    setState("searching");
    const t = setTimeout(async () => {
      const r = await findAddress(query).catch(() => ({ ok: false as const }));
      if (n !== seq.current) return;
      if (!r.ok) return setState("error");
      setResults(r.results);
      setState(r.results.length ? "idle" : "none");
    }, 350);
    return () => clearTimeout(t);
  }, [q, open, mapsAvailable, place?.address]);

  const located = place && place.lat !== null;
  return (
    <li className="relative">
      <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator [li:first-child>&]:hidden" />
      {open ? (
        <div className="flex flex-col gap-2 px-4 py-3">
          <label htmlFor={id} className="text-footnote font-semibold text-label-2">
            {slot.label}
          </label>
          <input
            id={id}
            // biome-ignore lint/a11y/noAutofocus: the row was just tapped to type an address
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={slot.placeholder}
            autoComplete="street-address"
            maxLength={300}
            className="min-h-11 rounded-control bg-bg px-3 text-body outline-none placeholder:text-label-2"
          />
          {mapsAvailable ? (
            <ul aria-live="polite" className="flex flex-col">
              {results.map((r) => (
                <li key={r.place_id ?? r.formatted_address}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onSave({
                        key: slot.key,
                        label: slot.label,
                        address: r.formatted_address,
                        lat: r.lat,
                        lng: r.lng,
                      })
                    }
                    className="press flex min-h-11 w-full items-center text-left text-subhead"
                  >
                    {r.formatted_address}
                  </button>
                </li>
              ))}
              {state === "searching" ? <li className="text-footnote text-label-2">Searching.</li> : null}
              {state === "none" ? (
                <li className="text-footnote text-label-2">No match. Try the street and the area.</li>
              ) : null}
              {state === "error" ? (
                <li className="text-footnote text-label-2">Search is not answering. Save it as typed.</li>
              ) : null}
            </ul>
          ) : (
            <p className="text-footnote text-label-2">
              Address search starts once maps are on our side. I keep what you type.
            </p>
          )}
          <HereButton slot={slot} busy={busy} onSave={onSave} />
          <div className="flex flex-wrap items-center gap-2">
            {(!mapsAvailable || state === "error" || state === "none") && q.trim().length >= 3 ? (
              <PendingButton
                disabled={busy}
                pending={pending === "save"}
                pendingLabel="Saving"
                onClick={() => onSave({ key: slot.key, label: slot.label, address: q.trim() })}
                className="press min-h-9 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint disabled:opacity-60"
              >
                Save as typed
              </PendingButton>
            ) : null}
            {place ? (
              <PendingButton
                disabled={busy}
                pending={pending === "remove"}
                pendingLabel="Removing"
                onClick={() => onSave(null)}
                className="press min-h-9 rounded-full px-3 text-subhead font-semibold text-tint-text disabled:opacity-60"
              >
                Remove
              </PendingButton>
            ) : null}
            <button
              type="button"
              onClick={() => onOpen(false)}
              className="hit press ml-auto min-h-9 px-1 text-subhead font-semibold text-tint-text"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(true)}
          className="press flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left"
        >
          <span className="text-body">{slot.label}</span>
          <span className="flex min-w-0 flex-col items-end">
            <span className={`max-w-full truncate text-subhead ${place ? "text-label-2" : "text-tint-text"}`}>
              {place?.address ?? (place ? "Set from your location" : "Add")}
            </span>
            {place && !located && mapsAvailable ? (
              <span className="text-footnote text-label-2">Not found on the map yet</span>
            ) : null}
          </span>
        </button>
      )}
    </li>
  );
}

export function PlacesEditor({
  places,
  mapsAvailable,
  travelEnabled,
  suggestions = [],
}: {
  places: Place[];
  mapsAvailable: boolean;
  travelEnabled: boolean;
  /** Places looked up often in Google Maps (#223), offered once each. */
  suggestions?: PlaceSuggestion[];
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState<string[]>([]);
  const [list, setList] = useState(places);
  const [open, setOpen] = useState<SlotKey | null>(places.some((p) => p.key === "home") ? null : "home");
  const [pending, setPending] = useState<Pending>(null);
  const busy = pending !== null;
  const [error, setError] = useState<string | null>(null);
  const [travel, setTravel] = useState(travelEnabled);
  const [travelError, setTravelError] = useState(false);
  const [native, setNative] = useState(true);
  useEffect(() => setNative("switch" in HTMLInputElement.prototype), []);
  useEffect(() => setList(places), [places]);

  async function save(key: SlotKey, next: PlaceInput | null) {
    const before = list;
    const rest = list.filter((p) => p.key !== key).map(toInput);
    const inputs = next ? [...rest, next] : rest;
    setPending({ key, op: next ? "save" : "remove" });
    setError(null);
    const r = await savePlaceList(inputs).catch(() => ({ ok: false as const, message: "" }));
    setPending(null);
    if (!r.ok) {
      setList(before);
      setError(r.message || "I couldn't save that. Nothing changed.");
      return;
    }
    // The first save switches Travel times on (the user's opt in), as the API does.
    if (next && before.length === 0) setTravel(true);
    setOpen(null);
    router.refresh();
  }

  function toggleTravel(on: boolean) {
    setTravel(on);
    setTravelError(false);
    saveSource("maps", on)
      .then((s) => setTravel(s.enabled))
      .catch(() => {
        setTravel(!on);
        setTravelError(true);
      });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Your places">
        <ul className="overflow-hidden rounded-group bg-fill">
          {SLOTS.map((s) => (
            <SlotRow
              key={s.key}
              slot={s}
              place={list.find((p) => p.key === s.key)}
              open={open === s.key}
              mapsAvailable={mapsAvailable}
              onOpen={(o) => setOpen(o ? s.key : null)}
              onSave={(p) => save(s.key, p)}
              busy={busy}
              pending={pending?.key === s.key ? pending.op : null}
            />
          ))}
        </ul>
        {error ? (
          <p role="alert" className="mt-2 px-4 text-subhead text-danger">
            {error}
          </p>
        ) : (
          <p className="mt-2 px-4 text-footnote text-label-2">
            Addresses stay with Michael. I only use them for drive times.
          </p>
        )}
      </section>

      {(() => {
        const offers = suggestions.filter(
          (x) =>
            x.key &&
            SLOTS.some((sl) => sl.key === x.key) &&
            !list.some((p) => p.key === x.key) &&
            !hidden.includes(x.label),
        );
        if (offers.length === 0) return null;
        return (
          <section aria-label="Places you look up often">
            <ul className="overflow-hidden rounded-group bg-fill">
              {offers.map((x, i) => {
                const slot = SLOTS.find((sl) => sl.key === x.key) as (typeof SLOTS)[number];
                return (
                  <li key={x.label} className="relative flex min-h-14 items-center gap-2 px-4 py-2">
                    {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body">
                        Save {x.label} as {slot.label.toLowerCase()}?
                      </span>
                      <span className="text-footnote text-label-2 tnum">
                        You looked it up {x.count} times in Maps.
                      </span>
                    </span>
                    <PendingButton
                      disabled={busy}
                      pending={pending?.key === slot.key && pending.op === "save"}
                      pendingLabel="Saving"
                      onClick={() =>
                        save(slot.key, {
                          key: slot.key,
                          label: slot.label,
                          address: x.label,
                          ...(x.lat !== null && x.lng !== null ? { lat: x.lat, lng: x.lng } : {}),
                        })
                      }
                      className="press min-h-9 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text disabled:opacity-60"
                    >
                      Save
                    </PendingButton>
                    <button
                      type="button"
                      onClick={() => setHidden((h) => [...h, x.label])}
                      className="press min-h-9 px-1 text-subhead font-semibold text-tint-text"
                    >
                      Not now
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })()}

      <section aria-label="Travel times">
        <label className="flex min-h-14 items-center justify-between gap-4 rounded-group bg-fill px-4 py-2">
          <span className="flex flex-col">
            <span className="text-body">Travel times</span>
            <span className="text-footnote text-label-2">
              {travelError
                ? "I couldn't save that. Try again."
                : "Traffic between your places and plans, from Google Maps"}
            </span>
          </span>
          <input
            type="checkbox"
            // @ts-expect-error: `switch` is a valid boolean attribute in Safari, not yet in React's types
            switch=""
            checked={travel}
            onChange={(e) => toggleTravel(e.target.checked)}
            className={native ? "h-[31px] w-[51px] shrink-0 accent-[var(--m-tint)]" : "m-switch shrink-0"}
          />
        </label>
        <p className="mt-2 px-4 text-footnote text-label-2">
          {!mapsAvailable
            ? "Your places are saved. Drive times start once Google Maps is ready on our side."
            : travel
              ? "I plan each day around traffic and only ever move your own blocks."
              : "Off. I do not look at traffic until you switch this on."}
        </p>
      </section>
    </div>
  );
}
