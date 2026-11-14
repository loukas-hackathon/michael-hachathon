"use client";

import { useActionState, useEffect, useId, useState, useTransition } from "react";
import { addGoal, editGoal, type FormState, pauseGoal, removeGoal } from "@/app/goals/actions";
import { CATEGORY_TITLE, type Category } from "@/lib/categories";
import { Sheet } from "../sheet";

export type GoalDraft = {
  id?: string;
  category: Category;
  title: string;
  kind: "time" | "target" | "count" | "checklist";
  hours: string;
  calendarTitles: string;
  unit: "hours_a_day" | "by_time" | "number_a_day";
  value: string;
  perWeek: string;
  label: string;
  messagesCount: boolean;
  active: boolean;
};

const EMPTY: GoalDraft = {
  category: "business",
  title: "",
  kind: "time",
  hours: "",
  calendarTitles: "",
  unit: "hours_a_day",
  value: "",
  perWeek: "",
  label: "",
  messagesCount: false,
  active: true,
};

const KINDS: { value: GoalDraft["kind"]; label: string; business?: boolean }[] = [
  { value: "time", label: "Hours" },
  { value: "target", label: "Target" },
  { value: "count", label: "Count" },
  { value: "checklist", label: "Checklist", business: true },
];

const initial: FormState = { ok: false, message: null };

/** Apple style segmented control on radio inputs, so the form posts the value. */
function Segmented<T extends string>({
  name,
  options,
  value,
  onChange,
  disabled = [],
}: {
  name: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: T[];
}) {
  return (
    <div
      role="radiogroup"
      className="grid gap-[2px] rounded-[9px] bg-fill p-[2px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <label
          key={o.value}
          className={`press relative flex min-h-9 items-center justify-center rounded-[7px] px-1 text-center text-footnote font-semibold ${
            value === o.value ? "bg-bg shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-label"
          } ${disabled.includes(o.value) ? "opacity-40" : ""}`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-11 items-center gap-3 px-4 [&+&]:before:absolute [&+&]:before:inset-x-0 [&+&]:before:top-0 [&+&]:before:ml-4 [&+&]:before:h-[0.5px] [&+&]:before:bg-separator [&+&]:before:content-['']">
      <label htmlFor={htmlFor} className="shrink-0 text-body">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </div>
  );
}

const input =
  "w-full min-w-0 bg-transparent text-right text-body text-label outline-none placeholder:text-label-2 focus-visible:outline-none";

function GoalForm({
  draft,
  formId,
  onDone,
  personalReady,
}: {
  draft: GoalDraft;
  formId: string;
  onDone: () => void;
  personalReady: boolean;
}) {
  const action = draft.id ? editGoal.bind(null, draft.id) : addGoal;
  const [state, formAction, pending] = useActionState(action, initial);
  const [category, setCategory] = useState<Category>(draft.category);
  const [kind, setKind] = useState<GoalDraft["kind"]>(draft.kind);
  const [unit, setUnit] = useState(draft.unit);
  const [label, setLabel] = useState<"fun" | "family" | "hobby">(
    (["fun", "family", "hobby"].includes(draft.label) ? draft.label : "fun") as "fun" | "family" | "hobby",
  );
  const uid = useId();

  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  useEffect(() => {
    if (kind === "checklist" && category !== "business") setKind("time");
  }, [category, kind]);

  return (
    <form id={formId} action={formAction} className="flex flex-col gap-6" aria-busy={pending}>
      <Segmented<Category>
        name="category"
        value={category}
        onChange={setCategory}
        options={(["business", "health", "personal"] as Category[]).map((c) => ({
          value: c,
          label: CATEGORY_TITLE[c],
        }))}
        disabled={personalReady ? [] : ["personal"]}
      />
      {category === "personal" && !personalReady ? (
        <p className="-mt-4 px-1 text-footnote text-label-2">
          Personal goals switch on later tonight, with the new categories.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-group bg-fill">
        <Row label="Name" htmlFor={`${uid}-title`}>
          <input
            id={`${uid}-title`}
            name="title"
            defaultValue={draft.title}
            required
            maxLength={60}
            autoComplete="off"
            placeholder={
              category === "business"
                ? "The company"
                : category === "health"
                  ? "70.3 training"
                  : "Rock N Roll"
            }
            className={input}
          />
        </Row>
      </div>

      <div className="flex flex-col gap-2">
        <Segmented<GoalDraft["kind"]>
          name="kind"
          value={kind}
          onChange={setKind}
          options={KINDS.filter((k) => !k.business || category === "business")}
        />
        <div className="overflow-hidden rounded-group bg-fill">
          {kind === "time" ? (
            <>
              <Row label="Hours a week" htmlFor={`${uid}-hours`}>
                <input
                  id={`${uid}-hours`}
                  name="hours"
                  inputMode="decimal"
                  defaultValue={draft.hours}
                  placeholder="9"
                  className={`${input} tnum`}
                />
              </Row>
              <Row label="Calendar blocks" htmlFor={`${uid}-cal`}>
                <input
                  id={`${uid}-cal`}
                  name="calendar_titles"
                  defaultValue={draft.calendarTitles}
                  placeholder="Cold Outreach, Call Leads"
                  autoComplete="off"
                  className={input}
                />
              </Row>
            </>
          ) : kind === "target" ? (
            <>
              <div className="px-4 py-2">
                <Segmented
                  name="unit"
                  value={unit}
                  onChange={setUnit}
                  options={[
                    { value: "hours_a_day", label: "Hours a day" },
                    { value: "by_time", label: "By a time" },
                    { value: "number_a_day", label: "A number" },
                  ]}
                />
              </div>
              <Row label="Target" htmlFor={`${uid}-value`}>
                <input
                  id={`${uid}-value`}
                  name="value"
                  type={unit === "by_time" ? "time" : "text"}
                  inputMode={unit === "by_time" ? undefined : "decimal"}
                  defaultValue={draft.value}
                  placeholder={unit === "hours_a_day" ? "7.5" : unit === "by_time" ? "23:00" : "2500"}
                  className={`${input} tnum`}
                />
              </Row>
            </>
          ) : kind === "count" ? (
            <Row label="Times a week" htmlFor={`${uid}-n`}>
              <input
                id={`${uid}-n`}
                name="per_week"
                inputMode="numeric"
                defaultValue={draft.perWeek}
                placeholder="1"
                className={`${input} tnum`}
              />
            </Row>
          ) : (
            <p className="px-4 py-3 text-subhead text-label-2">
              You set the day's items each Morning. Michael counts how many get done.
            </p>
          )}
        </div>
        {kind === "time" ? (
          <p className="px-4 text-footnote text-label-2">
            Blocks in your calendar whose title starts with one of these count for this goal.
          </p>
        ) : null}
      </div>

      {category === "business" && kind === "time" ? (
        <div className="flex flex-col gap-2">
          <div className="overflow-hidden rounded-group bg-fill">
            <Row label="Messages count as work" htmlFor={`${uid}-msg`}>
              <input
                id={`${uid}-msg`}
                name="messages_count"
                type="checkbox"
                defaultChecked={draft.messagesCount}
                className="m-switch"
              />
            </Row>
          </div>
          <p className="px-4 text-footnote text-label-2">
            For sales and outreach, mail and WhatsApp are the work, not a distraction.
          </p>
        </div>
      ) : null}

      {category === "personal" && personalReady ? (
        <div className="flex flex-col gap-2">
          <p className="px-4 text-footnote font-semibold text-label-2">Kind of time</p>
          <Segmented
            name="label"
            value={label}
            onChange={setLabel}
            options={[
              { value: "fun", label: "Fun" },
              { value: "family", label: "Family" },
              { value: "hobby", label: "Hobby" },
            ]}
          />
        </div>
      ) : null}

      {state.message && !state.ok ? (
        <p role="alert" className="px-1 text-subhead text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function SaveButton({ formId, label }: { formId: string; label: string }) {
  return (
    <button
      type="submit"
      form={formId}
      className="press -mr-2 h-11 px-2 text-body font-semibold text-tint-text"
    >
      {label}
    </button>
  );
}

/** "+" next to the Mi button: a new goal in one sheet. */
export function AddGoal({ personalReady }: { personalReady: boolean }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const formId = useId();
  const close = () => {
    setOpen(false);
    setKey((k) => k + 1);
  };
  return (
    <>
      <button
        type="button"
        aria-label="New goal"
        onClick={() => setOpen(true)}
        className="press -m-[7px] grid size-11 place-items-center rounded-full"
      >
        <span className="grid size-[30px] place-items-center rounded-full bg-fill text-tint-text">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px]">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      <Sheet
        open={open}
        onClose={close}
        title="New goal"
        trailing={<SaveButton formId={formId} label="Add" />}
      >
        <GoalForm key={key} draft={EMPTY} formId={formId} onDone={close} personalReady={personalReady} />
      </Sheet>
    </>
  );
}

/** A goal row that opens its edit sheet. */
export function EditGoal({
  draft,
  personalReady,
  children,
}: {
  draft: GoalDraft;
  personalReady: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const formId = useId();
  const close = () => {
    setOpen(false);
    setConfirmDelete(false);
    setNote(null);
  };
  const id = draft.id as string;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="press block w-full text-left">
        {children}
      </button>
      <Sheet
        open={open}
        onClose={close}
        title={draft.title}
        trailing={<SaveButton formId={formId} label="Save" />}
      >
        <GoalForm draft={draft} formId={formId} onDone={close} personalReady={personalReady} />
        <div className="mt-6 overflow-hidden rounded-group bg-fill">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await pauseGoal(id, !draft.active);
                setNote(r.message);
                if (r.ok) close();
              })
            }
            className="press flex min-h-11 w-full items-center px-4 text-body text-tint-text"
          >
            {draft.active ? "Pause this goal" : "Resume this goal"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              confirmDelete
                ? start(async () => {
                    const r = await removeGoal(id);
                    setNote(r.message);
                    if (r.ok) close();
                  })
                : setConfirmDelete(true)
            }
            className="press relative flex min-h-11 w-full items-center px-4 text-body text-danger before:absolute before:inset-x-0 before:top-0 before:ml-4 before:h-[0.5px] before:bg-separator before:content-['']"
          >
            {confirmDelete ? "Delete for good? Tap again" : "Delete this goal"}
          </button>
        </div>
        {note ? (
          <p role="status" className="mt-2 px-1 text-footnote text-label-2">
            {note}
          </p>
        ) : null}
      </Sheet>
    </>
  );
}
