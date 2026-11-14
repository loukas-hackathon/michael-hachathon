import type { Evidence, Lead } from "@/lib/day";
import { formatTime } from "@/lib/format";
import { MiMark } from "../brand";
import { UndoButton } from "./undo-button";

function Rich({ parts, strongClass }: { parts: Lead["insight"]; strongClass: string }) {
  return (
    <>
      {parts.map((p, i) =>
        p.strong ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static sentence parts
          <b key={i} className={strongClass}>
            {p.text}
          </b>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static sentence parts
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** "Phone every 21 minutes", proved: one strip of ticks across the window, one typical gap bracketed. */
function CadenceStrip({ evidence }: { evidence: Extract<Evidence, { kind: "cadence" }> }) {
  const from = new Date(evidence.from).getTime();
  const span = new Date(evidence.to).getTime() - from;
  const pos = (iso: string) => ((new Date(iso).getTime() - from) / span) * 100;
  const xs = evidence.sessions.map(pos);
  // Bracket the gap closest to the stated cadence, away from the edges.
  const minutesPerPct = span / 60_000 / 100;
  const pairs = xs.slice(0, -1).map((x, i) => [x, xs[i + 1] ?? x] as const);
  const inner = pairs.length > 2 ? pairs.slice(1, -1) : pairs;
  const [a, b] = inner.reduce(
    (best, p) =>
      Math.abs((p[1] - p[0]) * minutesPerPct - evidence.gapMinutes) <
      Math.abs((best[1] - best[0]) * minutesPerPct - evidence.gapMinutes)
        ? p
        : best,
    inner[0] ?? ([0, 0] as const),
  );
  return (
    <div
      role="img"
      aria-label={`${evidence.sessions.length} phone sessions between ${formatTime(evidence.from)} and ${formatTime(evidence.to)}`}
      className="relative h-[54px] select-none"
    >
      <span
        className="absolute top-0 -translate-x-1/2 text-caption font-semibold text-label-2 tnum"
        style={{ left: `${(a + b) / 2}%` }}
      >
        {evidence.gapMinutes} min
      </span>
      <span
        className="absolute top-[15px] h-[5px] border-x border-t border-label-2"
        style={{ left: `${a}%`, width: `${b - a}%` }}
      />
      <span className="absolute inset-x-0 top-[37px] h-px bg-separator" />
      {xs.map((x, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: ticks are positional
          key={i}
          className="absolute top-[23px] h-[14px] w-[2.5px] -translate-x-1/2 rounded-full bg-label"
          style={{ left: `clamp(1.25px, ${x}%, calc(100% - 1.25px))` }}
        />
      ))}
      <span className="absolute bottom-0 left-0 text-caption text-label-2 tnum">
        {formatTime(evidence.from)}
      </span>
      <span className="absolute right-0 bottom-0 text-caption text-label-2 tnum">
        {formatTime(evidence.to)}
      </span>
    </div>
  );
}

/** Michael's lead: one finding, its evidence, the one fix he already made, and the undo. */
export function MichaelCard({ lead }: { lead: Lead }) {
  return (
    <article className="mt-5 flex flex-col gap-2.5 rounded-card bg-fill px-4 pt-3.5 pb-4">
      <header className="flex items-center gap-2 text-footnote font-semibold">
        <span className="grid size-[22px] place-items-center rounded-full bg-label text-bg">
          <span className="block w-[13px]">
            <MiMark className="block h-auto w-full" />
          </span>
        </span>
        <span>Michael</span>
        <time className="ml-auto font-medium text-label-2 tnum" dateTime={lead.at}>
          {formatTime(lead.at)}
        </time>
      </header>
      <p className="text-insight tracking-[-0.01em] text-label-2">
        <Rich parts={lead.insight} strongClass="font-semibold text-label" />
      </p>
      {lead.evidence.kind === "cadence" ? <CadenceStrip evidence={lead.evidence} /> : null}
      <p className="text-subhead">
        <Rich parts={lead.fix} strongClass="font-semibold" />
      </p>
      {lead.action ? <UndoButton label={lead.action.label} done={lead.action.done} /> : null}
    </article>
  );
}
