"use client";

import { useActionState, useCallback, useEffect, useId, useOptimistic, useState, useTransition } from "react";
import {
  addHouseRule,
  addInstruction,
  editInstruction,
  type FormState,
  removeInstruction,
  saveQuietHours,
  toggleInstruction,
} from "@/app/you/instructions-actions";
import { HOUSE_RULES, type Instruction, type InstructionKind, instructionText } from "@/lib/instructions";
import { safeFormAction } from "@/lib/use-action";
import { input, Row, Segmented } from "../form-controls";
import { Sheet } from "../sheet";

const initial: FormState = { ok: false, message: null };
// Monday first on screen; values are 0 = Sunday, as the API stores them.
const DAYS: { value: number; label: string; name: string }[] = [
  { value: 1, label: "M", name: "Monday" },
  { value: 2, label: "T", name: "Tuesday" },
  { value: 3, label: "W", name: "Wednesday" },
  { value: 4, label: "T", name: "Thursday" },
  { value: 5, label: "F", name: "Friday" },
  { value: 6, label: "S", name: "Saturday" },
  { value: 0, label: "S", name: "Sunday" },
];

type Kind = Exclude<InstructionKind, "quiet_hours">;

function DayPicker({ value, onChange }: { value: number[]; onChange: (d: number[]) => void }) {
  return (
    <fieldset className="flex justify-between gap-1 px-4 py-2.5">
      <legend className="sr-only">Days</legend>
      {DAYS.map((d) => {
        const on = value.includes(d.value);
        return (
          <label
            key={d.value}
            className={`press grid size-10 cursor-pointer place-items-center rounded-full text-subhead font-semibold ${
              on ? "bg-label text-bg" : "bg-bg text-label"
            }`}
          >
            <input
              type="checkbox"
              name="days"
              value={d.value}
              checked={on}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, d.value] : value.filter((x) => x !== d.value))
              }
              className="sr-only"
              aria-label={d.name}
            />
            {d.label}
          </label>
        );
      })}
    </fieldset>
  );
}

function InstructionForm({
  item,
  formId,
  onDone,
  onPending,
}: {
  item: Instruction | null;
  formId: string;
  onDone: () => void;
  onPending: (pending: boolean) => void;
}) {
  const action = item ? editInstruction.bind(null, item.id) : addInstruction;
  const [state, formAction, pending] = useActionState(safeFormAction(action), initial);
  useEffect(() => {
    onPending(pending);
  }, [pending, onPending]);
  const [kind, setKind] = useState<Kind>(item && item.kind !== "quiet_hours" ? item.kind : "clear_day");
  const [days, setDays] = useState<number[]>(item?.days ?? (kind === "home_by" ? [1, 2, 3, 4, 5] : [0]));
  const [time, setTime] = useState(item?.time ?? "21:00");
  const [text, setText] = useState(item?.kind === "custom" ? item.text : "");
  const uid = useId();

  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  const preview = instructionText({ kind, days, time, text });

  return (
    <form id={formId} action={formAction} className="flex flex-col gap-5">
      <Segmented<Kind>
        name="kind"
        value={kind}
        onChange={(k) => {
          setKind(k);
          if (k === "home_by" && days.length === 1 && days[0] === 0) setDays([1, 2, 3, 4, 5]);
        }}
        options={[
          { value: "clear_day", label: "Keep clear" },
          { value: "home_by", label: "Home by" },
          { value: "custom", label: "Own words" },
        ]}
      />

      <div className="overflow-hidden rounded-group bg-fill">
        {kind === "custom" ? (
          <div className="px-4 py-3">
            <label htmlFor={`${uid}-text`} className="sr-only">
              Instruction
            </label>
            <textarea
              id={`${uid}-text`}
              name="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={140}
              placeholder="No calls during school pick up"
              className="w-full resize-none bg-transparent text-body text-label outline-none placeholder:text-label-2"
            />
          </div>
        ) : (
          <>
            {kind === "home_by" ? (
              <Row label="Home by" htmlFor={`${uid}-time`}>
                <input
                  id={`${uid}-time`}
                  name="time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={`${input} tnum`}
                />
              </Row>
            ) : null}
            <DayPicker value={days} onChange={setDays} />
          </>
        )}
      </div>

      <p className="px-4 text-footnote text-label-2">
        {kind === "custom"
          ? "Michael reads it before planning anything, and asks if it is unclear."
          : `Reads as: ${preview}.`}
      </p>

      {state.message && !state.ok ? (
        <p role="alert" className="px-1 text-subhead text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function QuietForm({
  start,
  end,
  formId,
  onDone,
  onPending,
}: {
  start: string;
  end: string;
  formId: string;
  onDone: () => void;
  onPending: (pending: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(safeFormAction(saveQuietHours), initial);
  useEffect(() => {
    onPending(pending);
  }, [pending, onPending]);
  const uid = useId();
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form id={formId} action={formAction} className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-group bg-fill">
        <Row label="From" htmlFor={`${uid}-s`}>
          <input id={`${uid}-s`} name="start" type="time" defaultValue={start} className={`${input} tnum`} />
        </Row>
        <Row label="To" htmlFor={`${uid}-e`}>
          <input id={`${uid}-e`} name="end" type="time" defaultValue={end} className={`${input} tnum`} />
        </Row>
      </div>
      <p className="px-4 text-footnote text-label-2">No nudges inside this window. It can cross midnight.</p>
      {state.message && !state.ok ? (
        <p role="alert" className="px-1 text-subhead text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** Header Save: outside the form, so the sheet passes pending down (michael-feedback R1). */
function Save({ formId, label, pending }: { formId: string; label: string; pending: boolean }) {
  return (
    <button
      type="submit"
      form={formId}
      disabled={pending}
      aria-busy={pending}
      className="press -mr-2 h-11 min-w-[4.5rem] px-2 text-right text-body font-semibold text-tint-text disabled:opacity-60"
    >
      {pending ? (label === "Add" ? "Adding" : "Saving") : label}
    </button>
  );
}

const separator =
  "before:absolute before:inset-x-0 before:top-0 before:ml-4 before:h-[0.5px] before:bg-separator before:content-['']";

/** Standing instructions under the Mi button: quiet hours first, then the user's own rules. */
export function StandingInstructions({
  available,
  items,
  quiet,
}: {
  available: boolean;
  items: Instruction[];
  quiet: { start: string; end: string } | null;
}) {
  const [sheet, setSheet] = useState<{ type: "quiet" } | { type: "edit"; item: Instruction | null } | null>(
    null,
  );
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(items, (list, change: { id: string; active: boolean }) =>
    list.map((i) => (i.id === change.id ? { ...i, active: change.active } : i)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const close = useCallback(() => {
    setSheet(null);
    setConfirm(false);
    setError(null);
  }, []);
  const editing = sheet?.type === "edit" ? sheet.item : null;
  // House rules the user does not have yet, one tap each (#190). Gone once added.
  const have = new Set(optimistic.map((i) => i.text.toLowerCase()));
  const suggested = available
    ? HOUSE_RULES.map((r, index) => ({ ...r, index })).filter((r) => !have.has(r.text.toLowerCase()))
    : [];
  const [adding, setAdding] = useState<number | null>(null);

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-title3 font-bold">Standing instructions</h2>
      <ul className="overflow-hidden rounded-group bg-fill">
        {quiet ? (
          <li>
            <button
              type="button"
              onClick={() => setSheet({ type: "quiet" })}
              className="press flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
            >
              <span className="text-body tnum">
                Quiet from {quiet.start} to {quiet.end}
              </span>
              <span className="text-footnote text-label-2">No nudges</span>
            </button>
          </li>
        ) : null}
        {optimistic.map((i) => (
          <li key={i.id} className={`relative flex min-h-11 items-center gap-3 pr-4 ${separator}`}>
            <button
              type="button"
              onClick={() => setSheet({ type: "edit", item: i })}
              className={`press min-h-11 min-w-0 flex-1 self-stretch py-2.5 pl-4 text-left text-body ${i.active ? "" : "text-label-2"}`}
            >
              {i.text}
            </button>
            <input
              type="checkbox"
              aria-label={i.text}
              checked={i.active}
              disabled={pending}
              onChange={(e) => {
                const active = e.target.checked;
                setError(null);
                start(async () => {
                  setOptimistic({ id: i.id, active });
                  try {
                    const res = await toggleInstruction(i.id, active);
                    if (!res.ok) setError(res.message ?? "I could not save that. Nothing changed.");
                  } catch {
                    setError("I could not reach the server. Nothing changed.");
                  }
                });
              }}
              className="hit m-switch shrink-0"
            />
          </li>
        ))}
        {suggested.map((r) => (
          <li key={r.text} className={`relative flex min-h-11 items-center gap-3 pr-4 ${separator}`}>
            <span className="min-w-0 flex-1 py-2.5 pl-4 text-body text-label-2">{r.text}</span>
            <button
              type="button"
              disabled={adding !== null}
              aria-busy={adding === r.index}
              aria-label={`Add: ${r.text}`}
              onClick={async () => {
                setAdding(r.index);
                setError(null);
                try {
                  const res = await addHouseRule(r.index);
                  if (!res.ok) setError(res.message ?? "I could not add it. Nothing changed.");
                } catch {
                  setError("I could not reach the server. Nothing changed.");
                } finally {
                  setAdding(null);
                }
              }}
              className="press flex h-9 shrink-0 items-center rounded-full bg-tint/14 px-4 text-subhead font-semibold text-tint-text disabled:opacity-60"
            >
              {adding === r.index ? "Adding" : "Add"}
            </button>
          </li>
        ))}
        {available ? (
          <li className={`relative ${separator}`}>
            <button
              type="button"
              onClick={() => setSheet({ type: "edit", item: null })}
              className="press flex min-h-11 w-full items-center gap-2 px-4 text-body text-tint-text"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px]">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
              Add an instruction
            </button>
          </li>
        ) : null}
      </ul>
      {error && sheet === null ? (
        <p role="alert" className="mt-2 px-4 text-footnote text-danger">
          {error}
        </p>
      ) : null}
      <p className="mt-2 px-4 text-footnote text-label-2">
        {available
          ? "Michael plans around these, and tells you when a block breaks one."
          : "More instructions, like keeping Sundays clear, switch on later tonight."}
      </p>

      <Sheet
        open={sheet?.type === "quiet"}
        onClose={close}
        title="Quiet hours"
        trailing={<Save formId={`${formId}-q`} label="Save" pending={saving} />}
      >
        {quiet ? (
          <QuietForm
            start={quiet.start}
            end={quiet.end}
            formId={`${formId}-q`}
            onDone={close}
            onPending={setSaving}
          />
        ) : null}
      </Sheet>

      <Sheet
        open={sheet?.type === "edit"}
        onClose={close}
        title={editing ? "Instruction" : "New instruction"}
        trailing={<Save formId={formId} label={editing ? "Save" : "Add"} pending={saving} />}
      >
        <InstructionForm
          key={editing?.id ?? "new"}
          item={editing}
          formId={formId}
          onDone={close}
          onPending={setSaving}
        />
        {editing ? (
          <div className="mt-6 overflow-hidden rounded-group bg-fill">
            <button
              type="button"
              disabled={pending}
              aria-busy={pending}
              onClick={() => {
                if (!confirm) return setConfirm(true);
                setError(null);
                start(async () => {
                  try {
                    const r = await removeInstruction(editing.id);
                    if (r.ok) close();
                    else setError(r.message ?? "I could not delete it. Nothing changed.");
                  } catch {
                    setError("I could not reach the server. Nothing changed.");
                  }
                });
              }}
              className="press flex min-h-11 w-full items-center px-4 text-body font-semibold text-danger disabled:opacity-60"
            >
              {pending && confirm
                ? "Deleting"
                : confirm
                  ? "Delete for good? Tap again"
                  : "Delete this instruction"}
            </button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 px-1 text-footnote text-danger">
            {error}
          </p>
        ) : null}
      </Sheet>
    </section>
  );
}
