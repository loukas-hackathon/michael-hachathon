"use client";

import type { LocationStatus } from "@michael/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { refreshLocation } from "@/app/you/connections/travel/actions";
import { useArriveConnection } from "@/components/you/connections-live";
import { ON_KEY, sendHere } from "./location-ping";

// The Location page's "Where you are" (#267): one tap to let this phone say where you are when
// you open Michael. Nothing runs before the tap.

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
  const arrive = useArriveConnection("travel");

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
        // The position landed: the Location row says Connected at once (#466).
        if (where !== null) arrive();
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
            className="hit press min-h-9 shrink-0 text-subhead font-semibold text-tint-text"
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

export function WhereYouAre({ status }: { status: LocationStatus | null }) {
  const now = status?.now
    ? `You are at ${status.now.label} since ${fmt(status.now.since)}.`
    : status?.last_signal_at
      ? `Last seen at ${fmt(status.last_signal_at)}.`
      : "No location yet.";
  return (
    <div className="flex flex-col gap-4">
      <p className="px-4 text-subhead text-label-2 tnum">{now}</p>
      <PhoneAsk />
    </div>
  );
}
