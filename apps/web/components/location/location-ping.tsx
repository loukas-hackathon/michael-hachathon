"use client";

import { useEffect } from "react";
import { sendPosition } from "@/app/you/connections/travel/actions";

// Where you are, each time you open Michael (#267). Never asks: it runs only after the one tap
// "Use this phone's location" on the Location page (which sets ON_KEY) and while the browser
// already allows it. At most one position every 10 minutes. The API drops it when the location
// switch is off or you are off the record; demo visitors get nothing stored.

export const ON_KEY = "michael.location.on";
const LAST_KEY = "michael.location.last";
const EVERY_MS = 10 * 60_000;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

/** Asks the browser for one position and sends it. Resolves with where the API put you, or null. */
export function sendHere(highAccuracy = false): Promise<string | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        write(LAST_KEY, String(Date.now()));
        const r = await sendPosition({
          kind: "point",
          at: new Date(pos.timestamp || Date.now()).toISOString(),
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: Math.round(pos.coords.accuracy),
        }).catch(() => null);
        resolve(r?.ok ? (r.at ?? null) : null);
      },
      () => resolve(null),
      { enableHighAccuracy: highAccuracy, timeout: 15_000, maximumAge: 5 * 60_000 },
    );
  });
}

export function LocationPing() {
  useEffect(() => {
    if (read(ON_KEY) !== "1") return;
    if (Date.now() - Number(read(LAST_KEY) ?? 0) < EVERY_MS) return;
    if (!navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((p) => {
        if (!cancelled && p.state === "granted") void sendHere();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
