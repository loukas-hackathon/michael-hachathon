import type { InsightStep } from "@/lib/insights";

/** "71 against 85" → ["71", "against 85"], so the number leads in the big size. */
function split(value: string): [string, string | null] {
  const at = value.indexOf(" against ");
  return at < 0 ? [value, null] : [value.slice(0, at), value.slice(at + 1)];
}

/** Two short bars for a comparable step: this time in black, the usual as an outline. */
function Pair({ value, usual }: { value: number; usual: number }) {
  const max = Math.max(value, usual, 1);
  return (
    <span aria-hidden="true" className="mt-1.5 flex w-full max-w-48 flex-col gap-1">
      <span
        className="h-1.5 rounded-full bg-label"
        style={{ width: `${Math.max(4, (value / max) * 100)}%` }}
      />
      <span
        className="h-1.5 rounded-full shadow-[inset_0_0_0_1px_var(--m-label-2)]"
        style={{ width: `${Math.max(4, (usual / max) * 100)}%` }}
      />
    </span>
  );
}

/**
 * A chain or link as its steps, top to bottom, joined by a hairline: the condition, then what
 * followed. Numbers first; a comparable step gets its pair of bars, this time against the usual.
 */
export function Chain({ steps }: { steps: InsightStep[] }) {
  return (
    <ol className="relative mt-4">
      {steps.map((s, n) => {
        const [lead, rest] = split(s.value);
        const last = n === steps.length - 1;
        return (
          <li key={s.label} className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0">
            {last ? null : (
              <span
                aria-hidden="true"
                className="absolute top-[18px] bottom-0 left-[8.5px] w-px bg-label-2/50"
              />
            )}
            <span
              aria-hidden="true"
              className={`mt-[5px] size-[9px] justify-self-center rounded-full ${
                n === 0 ? "bg-label" : "bg-bg shadow-[inset_0_0_0_1.5px_var(--m-label)]"
              }`}
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-footnote text-label-2">
                {n === 0 ? s.label : `then ${s.label.charAt(0).toLowerCase()}${s.label.slice(1)}`}
              </span>
              <span className="text-title3 font-bold tnum">
                {lead}
                {rest ? <span className="text-subhead font-semibold text-label-2"> {rest}</span> : null}
              </span>
              {s.value_num != null && s.usual_num != null ? (
                <Pair value={s.value_num} usual={s.usual_num} />
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
