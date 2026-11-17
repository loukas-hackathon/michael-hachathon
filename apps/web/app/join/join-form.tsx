"use client";

import {
  WAITLIST_CALENDAR_LABELS,
  WAITLIST_COMPUTER_LABELS,
  WAITLIST_PHONE_LABELS,
  WAITLIST_ROLE_LABELS,
} from "@michael/shared/waitlist-labels";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { input, Row, Segmented } from "@/components/form-controls";
import { joinWaitlist } from "./actions";

// The sign up (/join). One field set, one primary button. The pending label shows at once, the
// button holds still while the server answers, and an error is one line under it.

type Role = keyof typeof WAITLIST_ROLE_LABELS;
type Computer = keyof typeof WAITLIST_COMPUTER_LABELS;
type Phone = keyof typeof WAITLIST_PHONE_LABELS;
type Calendar = keyof typeof WAITLIST_CALENDAR_LABELS;

const options = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function JoinForm({ referral, source }: { referral: string | null; source: string | null }) {
  const id = useId();
  const router = useRouter();
  const [computer, setComputer] = useState<Computer>("mac");
  const [phone, setPhone] = useState<Phone>("iphone");
  const [calendar, setCalendar] = useState<Calendar>("google");
  const [founding, setFounding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<"email" | "name" | "hours" | null>(null);
  // One submission at a time: a ref, so a second tap before the re-render is ignored too.
  const inFlight = useRef(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    const hoursRaw = String(form.get("hours") ?? "").trim();
    const hours = Number(hoursRaw);
    const check = !EMAIL.test(email)
      ? { field: "email" as const, text: "That email doesn't look right." }
      : !name
        ? { field: "name" as const, text: "Tell me your name." }
        : !hoursRaw || !Number.isInteger(hours) || hours < 0 || hours > 80
          ? { field: "hours" as const, text: "Your best guess of the hours you lose a week, 0 to 80." }
          : null;
    if (check) {
      setInvalid(check.field);
      setLine(check.text);
      document.getElementById(`${id}-${check.field}`)?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setInvalid(null);
    setLine(null);
    try {
      const result = await joinWaitlist({
        email,
        name,
        role: String(form.get("role")) as Role,
        hours_lost_per_week: hours,
        computer,
        phone,
        calendar,
        founding_member: founding,
        ref: referral,
        source,
        website: String(form.get("website") ?? ""),
      });
      if (result.ok) {
        // Keep the pending label until the next page is on screen.
        router.push(`/join/${result.code}`);
        return;
      }
      setLine(result.line);
    } catch {
      setLine("I could not reach the list. Try again in a minute.");
    }
    inFlight.current = false;
    setBusy(false);
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby={`${id}-title`} className="mt-10">
      <h2 id={`${id}-title`} className="mb-2 text-title3 font-bold">
        Get in early
      </h2>
      {referral ? (
        <p className="mb-3 text-subhead text-label-2">A friend sent you. They move up when you join.</p>
      ) : null}

      <div className="rounded-group bg-fill">
        <Row label="Email" htmlFor={`${id}-email`}>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            placeholder="you@company.com"
            aria-invalid={invalid === "email" || undefined}
            className={`${input} h-11`}
          />
        </Row>
        <Row label="Name" htmlFor={`${id}-name`}>
          <input
            id={`${id}-name`}
            name="name"
            autoComplete="name"
            enterKeyHint="next"
            placeholder="Your name"
            maxLength={120}
            aria-invalid={invalid === "name" || undefined}
            className={`${input} h-11`}
          />
        </Row>
        <Row label="Role" htmlFor={`${id}-role`}>
          <select
            id={`${id}-role`}
            name="role"
            defaultValue="founder"
            className="h-11 min-w-0 appearance-none bg-transparent text-right text-body text-label outline-none"
          >
            {options(WAITLIST_ROLE_LABELS).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Hours you lose a week" htmlFor={`${id}-hours`}>
          <input
            id={`${id}-hours`}
            name="hours"
            type="number"
            inputMode="numeric"
            min={0}
            max={80}
            step={1}
            placeholder="6"
            aria-invalid={invalid === "hours" || undefined}
            className={`${input} tnum h-11 w-16`}
          />
        </Row>
      </div>

      <Choice label="Computer">
        <Segmented
          name="computer"
          options={options(WAITLIST_COMPUTER_LABELS)}
          value={computer}
          onChange={setComputer}
        />
      </Choice>
      <Choice label="Phone">
        <Segmented name="phone" options={options(WAITLIST_PHONE_LABELS)} value={phone} onChange={setPhone} />
      </Choice>
      <Choice label="Calendar">
        <Segmented
          name="calendar"
          options={options(WAITLIST_CALENDAR_LABELS)}
          value={calendar}
          onChange={setCalendar}
        />
      </Choice>

      <div className="mt-6 rounded-group bg-fill">
        <label htmlFor={`${id}-founding`} className="flex min-h-11 items-center gap-3 px-4 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-body">Founding member</span>
            <span className="block text-footnote text-label-2">€15 a month for life. No payment now.</span>
          </span>
          <input
            id={`${id}-founding`}
            name="founding"
            type="checkbox"
            role="switch"
            checked={founding}
            aria-checked={founding}
            onChange={(e) => setFounding(e.currentTarget.checked)}
            className="hit m-switch shrink-0"
          />
        </label>
      </div>

      {/* The honeypot: hidden from people and from screen readers, only a bot fills it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button
        type="submit"
        disabled={busy}
        aria-busy={busy || undefined}
        className="press mt-8 flex h-12 w-full items-center justify-center rounded-full bg-tint px-6 text-body font-semibold text-on-tint transition-opacity duration-200 disabled:opacity-60"
      >
        {busy ? "Joining" : "Join the waiting list"}
      </button>
      <p role="alert" className="mt-2 min-h-[18px] text-center text-footnote text-danger">
        {line}
      </p>
    </form>
  );
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-5">
      <legend className="mb-2 px-4 text-footnote text-label-2">{label}</legend>
      {children}
    </fieldset>
  );
}
