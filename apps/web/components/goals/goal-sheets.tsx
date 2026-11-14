"use client";

import { useActionState, useCallback, useEffect, useId, useState, useTransition } from "react";
import { addGoal, editGoal, type FormState, pauseGoal, removeGoal } from "@/app/goals/actions";
import { CATEGORY_TITLE, type Category } from "@/lib/categories";
import { safeFormAction } from "@/lib/use-action";
import { input, Row, Segmented } from "../form-controls";
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

// A placeholder that reads as a hint, never as a filled value.
const field = `${input} placeholder:text-label-2/50`;

/** Whether an existing goal uses anything behind "More options", so its sheet opens with it shown. */
function usesMore(d: GoalDraft): boolean {
  const titles = d.calendarTitles.trim();
  return (
    d.kind !== "time" ||
    (titles !== "" && titles.toLowerCase() !== d.title.trim().toLowerCase()) ||
    d.messagesCount ||
    (d.category === "personal" && d.label !== "" && d.label !== "fun")
  );
}

/**
 * Area, name and hours a week; everything else waits behind one "More options" row. The fields in
 * there stay mounted (only hidden) so the form always posts them. A new goal's calendar blocks
 * follow its name until edited, so a "Gym" goal counts "Gym" blocks without a second thought.
 */
function GoalForm({
  draft,
  formId,
  onDone,
  onPending,
  personalReady,
}: {
  draft: GoalDraft;
  formId: string;
  onDone: () => void;
  /** The Save button sits in the sheet header, outside the form, so it hears pending from here. */
  onPending: (pending: boolean) => void;
  personalReady: boolean;
}) {
  const action = draft.id ? editGoal.bind(null, draft.id) : addGoal;
  const [state, formAction, pending] = useActionState(safeFormAction(action), initial);
  const [category, setCategory] = useState<Category>(draft.category);
  const [kind, setKind] = useState<GoalDraft["kind"]>(draft.kind);
  const [unit, setUnit] = useState(draft.unit);
  const [label, setLabel] = useState<"fun" | "family" | "hobby">(
    (["fun", "family", "hobby"].includes(draft.label) ? draft.label : "fun") as "fun" | "family" | "hobby",
  );
  const [title, setTitle] = useState(draft.title);
  const [titles, setTitles] = useState(draft.calendarTitles);
  // An existing goal keeps its blocks as they are; a new one follows its name until edited.
  const [titlesEdited, setTitlesEdited] = useState(Boolean(draft.id));
  const [more, setMore] = useState(() => Boolean(draft.id) && usesMore(draft));
  const uid = useId();

  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  useEffect(() => {
    onPending(pending);
  }, [pending, onPending]);

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

      <div className="overflow-hidden rounded-group bg-fill">
        <Row label="Name" htmlFor={`${uid}-title`}>
          <input
            id={`${uid}-title`}
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={60}
            autoComplete="off"
            placeholder="What is it?"
            className={field}
          />
        </Row>
        {kind === "time" ? (
          <Row label="Hours a week" htmlFor={`${uid}-hours`}>
            <input
              id={`${uid}-hours`}
              name="hours"
              inputMode="decimal"
              defaultValue={draft.hours}
              placeholder="0"
              className={`${field} tnum`}
            />
          </Row>
        ) : kind === "target" ? (
          <Row
            label={unit === "by_time" ? "By" : unit === "hours_a_day" ? "Hours a day" : "A day"}
            htmlFor={`${uid}-value`}
          >
            <input
              id={`${uid}-value`}
              name="value"
              type={unit === "by_time" ? "time" : "text"}
              inputMode={unit === "by_time" ? undefined : "decimal"}
              defaultValue={draft.value}
              placeholder="0"
              className={`${field} tnum`}
            />
          </Row>
        ) : kind === "count" ? (
          <Row label="Times a week" htmlFor={`${uid}-n`}>
            <input
              id={`${uid}-n`}
              name="per_week"
              inputMode="numeric"
              defaultValue={draft.perWeek}
              placeholder="0"
              className={`${field} tnum`}
            />
          </Row>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          aria-controls={`${uid}-more`}
          className="press flex min-h-11 items-center justify-between px-1 text-body text-label-2"
        >
          More options
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={`size-3 transition-transform duration-200 ${more ? "rotate-90" : ""}`}
          >
            <path
              d="M4 2l4 4-4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div id={`${uid}-more`} hidden={!more} className="m-live-enter flex flex-col gap-3">
          <Segmented<GoalDraft["kind"]>
            name="kind"
            value={kind}
            onChange={setKind}
            options={KINDS.filter((k) => !k.business || category === "business")}
          />
          {kind === "target" ? (
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
          ) : null}
          {kind === "time" ? (
            <div className="overflow-hidden rounded-group bg-fill">
              <Row label="Calendar blocks" htmlFor={`${uid}-cal`}>
                <input
                  id={`${uid}-cal`}
                  name="calendar_titles"
                  value={titlesEdited ? titles : title}
                  onChange={(e) => {
                    setTitles(e.target.value);
                    setTitlesEdited(true);
                  }}
                  placeholder="Same as the name"
                  autoComplete="off"
                  className={field}
                />
              </Row>
              {category === "business" ? (
                <Row label="Messages count as work" htmlFor={`${uid}-msg`}>
                  <input
                    id={`${uid}-msg`}
                    name="messages_count"
                    type="checkbox"
                    defaultChecked={draft.messagesCount}
                    className="m-switch"
                  />
                </Row>
              ) : null}
            </div>
          ) : null}
          {category === "personal" && personalReady ? (
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
          ) : null}
        </div>
      </div>

      {state.message && !state.ok ? (
        <p role="alert" className="px-1 text-subhead text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function SaveButton({ formId, label, pending }: { formId: string; label: string; pending: boolean }) {
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

/** "+" next to the Mi button: a new goal in one sheet. */
export function AddGoal({ personalReady }: { personalReady: boolean }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const close = useCallback(() => {
    setOpen(false);
    setKey((k) => k + 1);
  }, []);
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
        trailing={<SaveButton formId={formId} label="Add" pending={saving} />}
      >
        <GoalForm
          key={key}
          draft={EMPTY}
          formId={formId}
          onDone={close}
          onPending={setSaving}
          personalReady={personalReady}
        />
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
  const [doing, setDoing] = useState<"pause" | "delete" | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const close = useCallback(() => {
    setOpen(false);
    setConfirmDelete(false);
    setNote(null);
  }, []);
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
        trailing={<SaveButton formId={formId} label="Save" pending={saving} />}
      >
        <GoalForm
          draft={draft}
          formId={formId}
          onDone={close}
          onPending={setSaving}
          personalReady={personalReady}
        />
        <div className="mt-6 overflow-hidden rounded-group bg-fill">
          <button
            type="button"
            disabled={pending}
            aria-busy={pending && doing === "pause"}
            onClick={() => {
              setDoing("pause");
              start(async () => {
                try {
                  const r = await pauseGoal(id, !draft.active);
                  setNote(r.message);
                  if (r.ok) close();
                } catch {
                  setNote("I could not reach the server. Nothing changed.");
                }
              });
            }}
            className="press flex min-h-11 w-full items-center px-4 text-body text-tint-text disabled:opacity-60"
          >
            {pending && doing === "pause"
              ? draft.active
                ? "Pausing"
                : "Resuming"
              : draft.active
                ? "Pause this goal"
                : "Resume this goal"}
          </button>
          <button
            type="button"
            disabled={pending}
            aria-busy={pending && doing === "delete"}
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true);
              setDoing("delete");
              start(async () => {
                try {
                  const r = await removeGoal(id);
                  setNote(r.message);
                  if (r.ok) close();
                } catch {
                  setNote("I could not reach the server. Nothing changed.");
                }
              });
            }}
            className="press relative flex min-h-11 w-full items-center px-4 text-body text-danger before:absolute before:inset-x-0 before:top-0 before:ml-4 before:h-[0.5px] before:bg-separator before:content-['']"
          >
            {pending && doing === "delete"
              ? "Deleting"
              : confirmDelete
                ? "Delete for good? Tap again"
                : "Delete this goal"}
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
