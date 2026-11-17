"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { haptic } from "@/components/haptics";
import { Tween } from "@/components/motion-ui";

// The place on the list, in Score style: the one headline number of the thank you page. It counts
// up once, only when arriving from the form (`?new=1`, dropped from the address straight after so
// a reload or a revisit never replays it), with one success tick. On a later visit, after friends
// joined, it moves from the place last seen here to the new one. The real number is always in the
// DOM; reduced motion shows it at once (globals.css, motion-ui.tsx).

const seenKey = (code: string) => `michael.place.${code}`;

export function Place({
  code,
  position,
  total,
  fresh,
}: {
  code: string;
  position: number;
  total: number;
  fresh: boolean;
}) {
  // The place last seen on this device, when it was a different one: it moves from there.
  const [from, setFrom] = useState<number | null>(null);

  useEffect(() => {
    let last: number | null = null;
    try {
      const raw = window.localStorage.getItem(seenKey(code));
      last = raw ? Number(raw) : null;
      window.localStorage.setItem(seenKey(code), String(position));
    } catch {
      // Private mode: no memory of the last visit, the number simply shows.
    }
    if (fresh) {
      haptic();
      // Drop ?new=1 without a server round trip (Next keeps its router in step with history).
      window.history.replaceState(window.history.state, "", window.location.pathname);
      return;
    }
    if (last && Number.isFinite(last) && last !== position) setFrom(last);
  }, [code, position, fresh]);

  return (
    <h1 className="mt-1 flex flex-col" data-testid="waitlist-position">
      <span className="sr-only">You are number </span>
      {fresh ? (
        <>
          <span className="sr-only">{position}</span>
          <span
            aria-hidden="true"
            className="m-count m-count-fresh font-num text-score font-extrabold tracking-[-0.02em] tnum"
            style={{ "--m-count-to": position } as CSSProperties}
          />
        </>
      ) : (
        <span className="font-num text-score font-extrabold tracking-[-0.02em] tnum">
          {from === null ? position : <Moves from={from} to={position} />}
        </span>
      )}
      <span className="mt-1 text-insight font-normal text-label-2">
        {" "}
        of <span className="tnum font-semibold text-label">{total.toLocaleString("en-GB")}</span> waiting.
      </span>
    </h1>
  );
}

/** Mounts at the old place, then moves to the new one (Tween, 450ms). */
function Moves({ from, to }: { from: number; to: number }) {
  const [value, setValue] = useState(from);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setValue(to));
    return () => cancelAnimationFrame(frame);
  }, [to]);
  return <Tween value={value} />;
}
