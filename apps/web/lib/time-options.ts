// The options of our own 24-hour time field (components/time-field.tsx, #393).

const pad = (n: number) => String(n).padStart(2, "0");

export const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));

/** The minutes on offer: every `step` minutes, plus the current one when it falls between. */
export function minuteOptions(step: number, current?: string): string[] {
  const out = Array.from({ length: Math.ceil(60 / step) }, (_, i) => pad(i * step));
  if (current && /^\d{2}$/.test(current) && Number(current) < 60 && !out.includes(current)) {
    out.push(current);
    out.sort();
  }
  return out;
}
