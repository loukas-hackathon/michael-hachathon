"use client";

import type { LocationStatus, Place } from "@michael/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { assignNetwork, refreshLocation } from "@/app/you/connections/travel/actions";
import { ON_KEY, sendHere } from "./location-ping";

// The Location page's "Where you are" (#267): one tap to let this phone say where you are when
// you open Michael, and the Mac's Wi-Fi networks to name in one tap. Nothing runs before the tap.

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Athens",
  }).format(new Date(iso));

function PhoneAsk() {
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [state, setState] = useState<"idle" | "finding" | "done" | "denied" | "failed">("idle");
  const [at, setAt] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    try {
      setOn(localStorage.getItem(ON_KEY) === "1");
    } catch {}
  }, []);

  function ask() {
    if (!("geolocation" in navigator)) return setState("failed");
    setState("finding");
    // The browser asks here, once, because the user tapped. Never on launch.
    navigator.geolocation.getCurrentPosition(
      async () => {
        try {
          localStorage.setItem(ON_KEY, "1");
        } catch {}
        setOn(true);
        const where = await sendHere(true);
        setAt(where);
        setState("done");
        await refreshLocation();
        startTransition(() => router.refresh());
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? "denied" : "failed"),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  function stop() {
    try {
      localStorage.removeItem(ON_KEY);
    } catch {}
    setOn(false);
    setState("idle");
  }

  return (
    <div className="flex flex-col gap-2">
      {on ? (
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-group bg-fill px-4 py-2">
          <span className="text-subhead">This phone says where you are when you open Michael.</span>
          <button
            type="button"
            onClick={stop}
            className="press min-h-9 shrink-0 text-subhead font-semibold text-tint-text"
          >
            Stop
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={ask}
          disabled={state === "finding"}
          aria-busy={state === "finding"}
          className="press flex h-11 w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint disabled:opacity-60"
        >
          {state === "finding" ? "Finding you" : "Use this phone's location"}
        </button>
      )}
      <p
        role={state === "denied" || state === "failed" ? "alert" : "status"}
        className="min-h-5 px-4 text-footnote text-label-2"
      >
        {state === "done"
          ? at
            ? `Saved. You are at ${at}.`
            : "Saved. I note where you are each time you open Michael."
          : state === "denied"
            ? "Location is off for Michael. Allow it in Settings, Safari, Location."
            : state === "failed"
              ? "I could not find you. Try again in a moment."
              : ""}
      </p>
    </div>
  );
}

function NetworkRow({ net, places }: { net: LocationStatus["networks"][number]; places: Place[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const mapped = places.find((p) => p.key === net.place_key);
  const suggested = places.find((p) => p.key === net.suggested_place_key);
  const name = net.name ?? `Network ${net.network.slice(0, 4)}`;

  async function choose(key: string | null) {
    setBusy(key ?? "forget");
    setError(null);
    try {
      const r = await assignNetwork(net.network, key);
      if (!r.ok) setError(r.message);
      else startTransition(() => router.refresh());
    } catch {
      setError("I could not reach the server. Nothing changed.");
    } finally {
      setBusy(null);
    }
  }

  // The suggested place first, then the rest.
  const options = suggested ? [suggested, ...places.filter((p) => p !== suggested)] : places;
  return (
    <li className="relative flex flex-col gap-2 px-4 py-3">
      <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator [li:first-child>&]:hidden" />
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body">{name}</span>
        <span className="text-footnote text-label-2 tnum">Seen {fmt(net.last_seen_at)}</span>
      </div>
      {mapped ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-subhead text-label-2">{mapped.label}&apos;s Wi-Fi</span>
          <button
            type="button"
            onClick={() => choose(null)}
            disabled={busy !== null}
            className="press min-h-9 text-subhead font-semibold text-tint-text disabled:opacity-60"
          >
            {busy === "forget" ? "Forgetting" : "Forget"}
          </button>
        </div>
      ) : places.length ? (
        <div className="flex flex-wrap gap-2">
          {options.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => choose(p.key)}
              disabled={busy !== null}
              aria-busy={busy === p.key}
              className={`press min-h-9 rounded-full px-4 text-subhead font-semibold disabled:opacity-60 ${
                p === suggested ? "bg-tint text-on-tint" : "bg-fill text-label"
              }`}
            >
              {busy === p.key ? "Saving" : p === suggested ? `This is ${p.label}'s Wi-Fi` : p.label}
            </button>
          ))}
        </div>
      ) : (
        <span className="text-subhead text-label-2">Save a place below, then name this network.</span>
      )}
      {error ? (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function WhereYouAre({ status, places }: { status: LocationStatus | null; places: Place[] }) {
  const now = status?.now
    ? `You are at ${status.now.label} since ${fmt(status.now.since)}.`
    : status?.last_signal_at
      ? `Last seen at ${fmt(status.last_signal_at)}.`
      : "No location yet.";
  return (
    <div className="flex flex-col gap-4">
      <p className="px-4 text-subhead text-label-2 tnum">{now}</p>
      <PhoneAsk />
      {status?.networks.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="px-4 text-footnote font-semibold text-label-2">Wi-Fi your Mac has been on</h3>
          <ul className="rounded-group bg-fill">
            {status.networks.slice(0, 6).map((n) => (
              <NetworkRow key={n.network} net={n} places={places} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
