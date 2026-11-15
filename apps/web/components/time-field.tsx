"use client";

import { HOURS, minuteOptions } from "@/lib/time-options";

// Our own 24-hour time field (#393): an hour and a minute select. A native `type=time` follows the
// browser's locale and shows "10:00 AM" in an en-US browser; these options are ours, so it is always
// 24-hour. Native selects keep the phone's wheel, the keyboard and VoiceOver for free.

const SELECT =
  "min-h-9 appearance-none bg-transparent px-1 text-center text-body font-semibold text-label tnum outline-none";

export function TimeField({
  id,
  label,
  value,
  onChange,
  step = 15,
  emptyLabel,
}: {
  id: string;
  /** What the time is for ("Starts"): names each select for screen readers. */
  label: string;
  /** "HH:MM", or "" when `emptyLabel` allows no time. */
  value: string;
  onChange: (hhmm: string) => void;
  step?: number;
  /** Offer no time at all, shown as this word in the hour select ("Now"). */
  emptyLabel?: string;
}) {
  const [h = "", m = ""] = value ? value.split(":") : [];
  const minutes = minuteOptions(step, m);
  return (
    <span className="inline-flex items-center rounded-control bg-bg px-1.5">
      <select
        id={id}
        aria-label={`${label}, hour`}
        value={h}
        onChange={(e) => {
          const hour = e.target.value;
          onChange(hour ? `${hour}:${m || "00"}` : "");
        }}
        className={SELECT}
      >
        {emptyLabel ? <option value="">{emptyLabel}</option> : null}
        {HOURS.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
      {h ? (
        <>
          <span aria-hidden="true" className="text-body font-semibold text-label">
            :
          </span>
          <select
            aria-label={`${label}, minutes`}
            value={m}
            onChange={(e) => onChange(`${h}:${e.target.value}`)}
            className={SELECT}
          >
            {minutes.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </span>
  );
}
