"use client";

import {
  WAITLIST_CALENDAR_LABELS,
  WAITLIST_COMPUTER_LABELS,
  WAITLIST_PHONE_LABELS,
  WAITLIST_ROLE_LABELS,
} from "@michael/shared/waitlist-labels";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { input, Row, Segmented } from "@/components/form-controls";
import { Collapse } from "@/components/motion-ui";
import { joinWaitlist } from "./actions";

// The sign up (/join): the fewest fields that still qualify. The hours question is the hook and
// the qualifier at once (chips, one tap, no keyboard), then email and an optional name, then the
// setup folded into one row most people never open (guessed from the device). Founding member is
// asked on the thank you page, where it is a reward, not a hurdle. One pink button; the pending
// label shows at once and holds until the next page paints; an error is one line under it.

type Role = keyof typeof WAITLIST_ROLE_LABELS;
type Computer = keyof typeof WAITLIST_COMPUTER_LABELS;
type Phone = keyof typeof WAITLIST_PHONE_LABELS;
type Calendar = keyof typeof WAITLIST_CALENDAR_LABELS;

const options = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

/** The chips, and what each sends: "10h+" is sent as 12. */
const HOURS = [
  { value: "2", label: "2h" },
  { value: "4", label: "4h" },
  { value: "6", label: "6h" },
  { value: "8", label: "8h" },
  { value: "12", label: "10h+" },
] as const;
type Hours = (typeof HOURS)[number]["value"];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The setup most visitors have, read from this device: a Windows laptop, an Android phone. */
function guessDevice(ua: string): { computer: Computer; phone: Phone } {
  const android = /Android/i.test(ua);
  const computer: Computer = /Windows/i.test(ua)
    ? "windows"
    : /Linux/i.test(ua) && !android
      ? "linux"
      : "mac";
  return { computer, phone: android ? "android" : "iphone" };
}

export function JoinForm({ referral, source }: { referral: string | null; source: string | null }) {
  const id = useId();
  const router = useRouter();
  const [hours, setHours] = useState<Hours | "">("");
  const [role, setRole] = useState<Role>("founder");
  const [computer, setComputer] = useState<Computer>("mac");
  const [phone, setPhone] = useState<Phone>("iphone");
  const [calendar, setCalendar] = useState<Calendar>("google");
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<"email" | "hours" | null>(null);
  // One submission at a time: a ref, so a second tap before the re-render is ignored too.
  const inFlight = useRef(false);

  // Smart defaults: the setup row reads true for most visitors without a tap.
  useEffect(() => {
    const guess = guessDevice(navigator.userAgent);
    setComputer(guess.computer);
    setPhone(guess.phone);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    const check = !hours
      ? { field: "hours" as const, text: "Pick your best guess." }
      : !EMAIL.test(email)
        ? { field: "email" as const, text: "That email doesn't look right." }
        : null;
    if (check) {
      setInvalid(check.field);
      setLine(check.text);
      const target =
        check.field === "hours"
          ? document.getElementById(`${id}-hours`)?.querySelector("input")
          : document.getElementById(`${id}-email`);
      target?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setInvalid(null);
    setLine(null);
    try {
      const result = await joinWaitlist({
        email,
        name: name || null,
        role,
        hours_lost_per_week: Number(hours),
        computer,
        phone,
        calendar,
        founding_member: false,
        ref: referral,
        source,
        website: String(form.get("website") ?? ""),
      });
      if (result.ok) {
        // Keep the pending label until the next page is on screen; it counts up once from here.
        router.push(`/join/${result.code}?new=1`);
        return;
      }
      setLine(result.line);
    } catch {
      setLine("I could not reach the list. Try again in a minute.");
    }
    inFlight.current = false;
    setBusy(false);
  }

  const summary = [
    WAITLIST_ROLE_LABELS[role],
    WAITLIST_COMPUTER_LABELS[computer],
    WAITLIST_PHONE_LABELS[phone],
    WAITLIST_CALENDAR_LABELS[calendar],
  ].join(" · ");

  return (
    <form onSubmit={submit} noValidate aria-label="Join the waiting list" className="mt-8 lg:mt-0">
      {referral ? (
        <p className="mb-3 text-subhead text-label-2">A friend sent you. They move up when you join.</p>
      ) : null}
      <h2 id={`${id}-hours-q`} className="text-title3 font-bold">
        How many hours a week do you lose?
      </h2>
      <div
        id={`${id}-hours`}
        className={`mt-3 rounded-[9px] ${invalid === "hours" ? "shadow-[0_0_0_1.5px_var(--m-danger)]" : ""}`}
      >
        <Segmented
          name="hours"
          size="lg"
          labelledBy={`${id}-hours-q`}
          options={HOURS.map((h) => ({ value: h.value, label: h.label }))}
          value={hours}
          onChange={(v) => {
            setHours(v);
            if (invalid === "hours") {
              setInvalid(null);
              setLine(null);
            }
          }}
        />
      </div>

      <div className="mt-4 rounded-group bg-fill">
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
            enterKeyHint="done"
            placeholder="Optional"
            maxLength={120}
            className={`${input} h-11`}
          />
        </Row>
        <div className="relative before:absolute before:inset-x-0 before:top-0 before:ml-4 before:h-[0.5px] before:bg-separator before:content-['']">
          <button
            type="button"
            aria-expanded={setupOpen}
            aria-controls={`${id}-setup`}
            onClick={() => setSetupOpen((o) => !o)}
            className="flex min-h-11 w-full items-center gap-3 rounded-group px-4 text-left active:bg-[color-mix(in_srgb,var(--m-label)_6%,transparent)]"
          >
            <span className="shrink-0 text-body">Setup</span>
            <span
              className="min-w-0 flex-1 truncate text-right text-body text-label-2"
              data-testid="join-setup"
            >
              {summary}
            </span>
            <span
              aria-hidden="true"
              className={`shrink-0 text-label-2 transition-transform duration-[var(--m-dur-ui)] ease-[var(--m-ease-out)] motion-reduce:transition-none ${setupOpen ? "rotate-90" : ""}`}
            >
              ›
            </span>
          </button>
        </div>
      </div>

      <Collapse open={setupOpen} id={`${id}-setup`}>
        <div className="pt-4">
          <div className="rounded-group bg-fill">
            <Row label="Role" htmlFor={`${id}-role`}>
              <select
                id={`${id}-role`}
                name="role"
                value={role}
                onChange={(e) => setRole(e.currentTarget.value as Role)}
                className="h-11 min-w-0 appearance-none bg-transparent text-right text-body text-label outline-none"
              >
                {options(WAITLIST_ROLE_LABELS).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
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
            <Segmented
              name="phone"
              options={options(WAITLIST_PHONE_LABELS)}
              value={phone}
              onChange={setPhone}
            />
          </Choice>
          <Choice label="Calendar">
            <Segmented
              name="calendar"
              options={options(WAITLIST_CALENDAR_LABELS)}
              value={calendar}
              onChange={setCalendar}
            />
          </Choice>
        </div>
      </Collapse>

      {/* The honeypot: hidden from people and from screen readers, only a bot fills it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button
        type="submit"
        disabled={busy}
        aria-busy={busy || undefined}
        className="press mt-6 flex h-[50px] w-full items-center justify-center rounded-full bg-tint px-6 text-body font-semibold text-on-tint transition-opacity duration-[var(--m-dur-ui)] disabled:opacity-60"
      >
        {busy ? "Joining" : "Join the waiting list"}
      </button>
      <p role="alert" className="mt-2 text-center text-footnote text-danger">
        {line}
      </p>
      <p className="mt-1 text-center text-footnote text-label-2">
        One email when it's your turn. Nothing else.
      </p>
    </form>
  );
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-4">
      <legend className="mb-2 px-4 text-footnote text-label-2">{label}</legend>
      {children}
    </fieldset>
  );
}
