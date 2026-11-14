import type { AgentQuery } from "@michael/shared";
import { UndoButton } from "@/components/today/undo-button";
import { type AgentDay, countLine, isWrite } from "@/lib/agents";
import { formatTime } from "@/lib/format";

// "Booked "Sales focus"" reads better with typographic quotes.
const lower = (s: string) => (s.charAt(0).toLowerCase() + s.slice(1)).replace(/"([^"]*)"/g, "\u201c$1\u201d");

/** The agent's initial in a soft square: the same mark as the agent rows. */
export function AgentMark({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-[34px] shrink-0 place-items-center rounded-[9px] bg-context text-subhead font-bold"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Line({ name, q, sample, last }: { name: string; q: AgentQuery; sample: boolean; last: boolean }) {
  const write = q.allowed && isWrite(q);
  const undoUntil = write && q.recommendation_id && q.undo_until ? q.undo_until : null;
  return (
    <li className="relative grid grid-cols-[44px_14px_1fr] gap-x-2 px-4">
      <time dateTime={q.created_at} className="pt-[11px] text-footnote font-semibold text-label-2 tnum">
        {formatTime(q.created_at)}
      </time>
      {/* The rail: a filled dot for a change, a hollow one for a read, nothing shared shows grey. */}
      <span aria-hidden="true" className="relative flex justify-center">
        {last ? null : <span className="absolute top-[22px] -bottom-[14px] w-px bg-separator" />}
        <span
          className={`relative mt-[15px] size-[9px] rounded-full ${
            write
              ? "bg-label"
              : q.allowed
                ? "bg-fill shadow-[inset_0_0_0_1.5px_var(--m-label-2)]"
                : "bg-fill shadow-[inset_0_0_0_1.5px_var(--m-context)]"
          }`}
        />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5 py-[9px]">
        {q.allowed ? (
          <p className={`text-subhead ${write ? "font-semibold" : ""}`}>
            {name} {lower(q.summary)}
          </p>
        ) : (
          <p className="text-subhead text-label-2">
            {isWrite(q)
              ? `${name} tried a change: ${lower(q.summary)}.`
              : `${name} asked to ${lower(q.summary)}.`}{" "}
            <span className="font-semibold">{isWrite(q) ? "Refused." : "Not shared."}</span>
          </p>
        )}
        {undoUntil ? (
          <UndoButton
            label={`Undo until ${formatTime(undoUntil)}`}
            done="Undone. Your calendar is back as it was."
            recommendationId={sample ? undefined : (q.recommendation_id ?? undefined)}
          />
        ) : write && q.recommendation_id ? (
          <p className="text-footnote text-label-2">Started or undone. It stays as it is.</p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Who asked about you today, grouped by agent: one inset group per agent with a header line
 * ("Claude, 4 questions, 1 change") and its questions as a timeline. Changes are highlighted
 * with a filled dot and carry Undo while it still works.
 */
export function QueryLog({ days, sample }: { days: AgentDay[]; sample: boolean }) {
  return (
    <section aria-labelledby="asked-today" className="mt-6">
      <h2 id="asked-today" className="mb-2 text-title3 font-bold">
        Who asked today
      </h2>
      <div className="flex flex-col gap-3">
        {days.map((d) => (
          <article
            key={d.agent.id}
            aria-label={`${d.agent.name}, ${countLine(d)}`}
            className="overflow-hidden rounded-group bg-fill pb-1.5"
          >
            <header className="flex items-center gap-3 px-4 pt-3 pb-1.5">
              <AgentMark name={d.agent.name} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-body font-semibold">{d.agent.name}</span>
                <span className="text-footnote text-label-2 tnum">
                  {countLine(d)}
                  {d.agent.status === "pending" ? ". Waiting for you" : ""}
                  {d.agent.status === "revoked" ? ". Revoked" : ""}
                </span>
              </div>
            </header>
            <ol>
              {d.queries.map((q, i) => (
                <Line
                  key={q.id}
                  name={d.agent.name}
                  q={q}
                  sample={sample}
                  last={i === d.queries.length - 1}
                />
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}
