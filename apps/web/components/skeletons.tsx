import { CONNECTOR_STATUS } from "@michael/shared";
import { Bone, Group, Lines, Pending, RowRule, SectionTitle } from "./skeleton";
import { Thinking } from "./thinking";

/*
 * Section skeletons, one per real section, built from that section's own box model (margins,
 * paddings, radii, line heights) so the swap moves nothing. Each names the component it mirrors:
 * change one, change the other. Use them in a route's loading.tsx, or as a Suspense fallback
 * inside <Pending> (components/skeleton.tsx) with the section's outer margin.
 */

/* ---------- Today (app/page.tsx) ---------- */

/** The week as seven bars against the keep line (components/today/keep-week.tsx), dot and letter. */
export function KeepWeekSkeleton() {
  return (
    <ol aria-hidden="true" className="mt-4 grid grid-cols-7 gap-2">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <li key={i} className="flex min-w-0 flex-col items-center gap-1.5">
          <Bone className="h-[96px] w-full rounded-[8px]" />
          <span className="size-1.5" />
          <Lines text="caption" widths={["0.6rem"]} />
        </li>
      ))}
    </ol>
  );
}

/** The tape (components/tape.tsx): one 12px rounded bar under the room for the now label. */
export function TapeSkeleton() {
  return (
    <div aria-hidden="true" className="pt-[18px]">
      <Bone className="h-3 w-full rounded-full" />
    </div>
  );
}

/**
 * "Goal time today" (app/page.tsx): the label, the score and its line, the week's bars and lines,
 * the tape and its key, then the week's lost time and the time won back.
 */
export function TodayScoreSkeleton() {
  return (
    <>
      <section aria-hidden="true" className="mt-3">
        <div className="flex flex-col">
          <Lines text="footnote" widths={["7.5rem"]} />
          <Lines text="score" widths={["10.5rem"]} />
          <Lines text="title3" widths={["14rem", "15rem"]} />
        </div>
        <KeepWeekSkeleton />
        <Lines text="subhead" className="mt-3" widths={["96%", "2.5rem"]} />
        <Lines text="subhead" className="mt-1" widths={["100%", "45%"]} />
        <Lines text="subhead" className="mt-1" widths={["90%"]} />
        <div className="mt-5">
          <div className="mt-3">
            <TapeSkeleton />
          </div>
          <Lines text="footnote" className="mt-2" widths={["16rem"]} />
          <Lines text="subhead" className="mt-2" widths={["88%", "30%"]} />
        </div>
      </section>
      <Lines text="subhead" className="mt-1" widths={["92%", "55%"]} />
      <Lines text="body" className="mt-2" widths={["13rem"]} />
    </>
  );
}

/**
 * One suggestion card (components/today/recommendation-list.tsx, Card): when, title, the reason,
 * the maths, then the buttons. `heading` adds "Your next move" above it, as on Today.
 */
export function ActionSkeleton({ heading = true }: { heading?: boolean }) {
  return (
    <section aria-hidden="true" className="mt-6">
      {heading ? <SectionTitle width="9.5rem" /> : null}
      <Group className="flex flex-col gap-1.5 px-4 pt-3 pb-3.5">
        <Lines text="footnote" widths={["9rem"]} />
        <Lines text="body" widths={["85%"]} />
        <Lines text="subhead" widths={["100%", "96%", "100%", "12%"]} />
        <Lines text="subhead" widths={["11rem"]} />
        <div className="mt-1 flex items-center gap-2">
          <Bone className="h-9 w-[65px] rounded-full" />
          <span className="flex h-11 items-center px-1">
            <Lines text="subhead" widths={["3.8rem"]} />
          </span>
        </div>
      </Group>
    </section>
  );
}

/** Michael's card (components/today/michael-card.tsx): who and when, the line, a chart, the act. */
export function MichaelCardSkeleton({ className = "mt-6" }: { className?: string }) {
  return (
    <Group rounded="card" className={`flex flex-col gap-2.5 px-4 pt-3.5 pb-4 ${className}`}>
      <div className="flex h-[22px] items-center gap-2">
        <Bone className="size-[22px] rounded-full" />
        <Lines text="footnote" widths={["3.5rem"]} />
        <Lines text="footnote" className="ml-auto" widths={["2.2rem"]} />
      </div>
      <Lines text="insight" widths={["92%", "60%"]} />
      <Bone className="h-[54px] w-full" />
      <Lines text="subhead" widths={["96%", "55%"]} />
      <div className="flex items-center gap-2">
        <Bone className="h-9 w-32 rounded-full" />
        <Lines text="subhead" widths={["5.5rem"]} />
      </div>
    </Group>
  );
}

/** "More from Michael" (components/today/fold.tsx): quiet rows of a title and one line. */
export function FoldRowsSkeleton({ rows = 3, heading = true }: { rows?: number; heading?: boolean }) {
  return (
    <section aria-hidden="true" className={heading ? "mt-8" : undefined}>
      {heading ? <SectionTitle width="11rem" /> : null}
      <Group>
        {Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
          <div key={i} className="relative flex min-h-[60px] items-center gap-3 px-4 py-2.5">
            {i > 0 ? <RowRule /> : null}
            <span className="flex min-w-0 flex-1 flex-col">
              <Lines text="body" widths={[["10rem", "8rem", "12rem"][i % 3] as string]} />
              <Lines text="footnote" widths={["75%"]} />
            </span>
            <Bone className="size-4 rounded-full" />
          </div>
        ))}
      </Group>
    </section>
  );
}

/**
 * Today's Suspense fallback for "More from Michael" while the brief, moment and watch stream in:
 * the real heading with Michael visibly thinking beside it (#378), then the rows' bones.
 */
export function MoreFromMichaelSkeleton() {
  return (
    <Pending label="Reading your day">
      <div aria-hidden="true" className="mt-8 mb-2 flex items-baseline justify-between gap-3">
        <span className="text-title3 font-bold">More from Michael</span>
        <Thinking />
      </div>
      <FoldRowsSkeleton heading={false} />
    </Pending>
  );
}

/** The empty state card (components/empty-state.tsx): title and one or two lines. */
export function EmptyStateSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <Group rounded="card" className="mt-8 flex flex-col gap-2 px-4 pt-4 pb-5">
      <Lines text="title3" widths={["8rem"]} />
      <Lines text="subhead" widths={lines > 1 ? ["94%", "60%"] : ["80%"]} />
    </Group>
  );
}

/**
 * Get started (components/today/get-started.tsx, #181): title and count, the progress segments,
 * then one row per step; the next step is open with its reason and button.
 */
export function GetStartedSkeleton({ steps = 4, next = 1 }: { steps?: number; next?: number }) {
  return (
    <Group rounded="card" className="mt-4 px-4 pt-3.5 pb-1">
      <div className="flex items-baseline justify-between gap-3">
        <Lines text="title3" widths={["7.5rem"]} />
        <Lines text="footnote" widths={["2.6rem"]} />
      </div>
      <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${steps}, minmax(0, 1fr))` }}>
        {Array.from({ length: steps }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder segments
          <Bone key={i} className="h-1 rounded-full" />
        ))}
      </div>
      <ol className="mt-1.5">
        {Array.from({ length: steps }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder steps
          <li key={i} className="relative">
            {i > 0 ? <RowRule inset={36} /> : null}
            {i === next ? (
              <div className="flex gap-3 py-3">
                <Bone className="size-6 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <Lines text="body" widths={["11rem"]} />
                  <Lines text="subhead" widths={["95%", "50%"]} />
                  <Bone className="mt-2.5 h-9 w-28 rounded-full" />
                </div>
              </div>
            ) : (
              <div className="flex min-h-11 items-center gap-3 py-2">
                <Bone className="size-6 shrink-0 rounded-full" />
                <Lines
                  text="body"
                  className="flex-1"
                  widths={[["9rem", "12rem", "10rem"][i % 3] as string]}
                />
              </div>
            )}
          </li>
        ))}
      </ol>
    </Group>
  );
}

/* ---------- Timeline (app/timeline/page.tsx) ---------- */

/**
 * Lost from your goal blocks (components/timeline/lost-week.tsx): the label, the week's number,
 * seven hatched bars, what took it, then the footnote.
 */
export function LostWeekSkeleton() {
  return (
    <section aria-hidden="true" className="mt-3">
      <Lines text="footnote" widths={["10.5rem"]} />
      <div className="mt-0.5 flex h-[44px] items-center gap-2">
        <Bone className="h-[34px] w-[7.5rem] rounded-[6px]" />
        <Lines text="title3" widths={["5.5rem"]} />
      </div>
      <ol className="mt-4 grid grid-cols-7 gap-1.5">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <li key={i} className="flex h-[82px] items-end justify-center">
            <Bone className="h-[46px] w-full max-w-9 rounded-t-[5px]" />
          </li>
        ))}
      </ol>
      <div className="mt-4">
        <Lines text="footnote" className="mb-2" widths={["5.5rem"]} />
        <Group>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="relative grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5"
            >
              {i > 0 ? <RowRule /> : null}
              <Lines text="body" widths={["5.5rem"]} />
              <Bone className="h-2.5 rounded-full" />
              <Lines text="subhead" widths={["2.5rem"]} />
            </div>
          ))}
        </Group>
      </div>
      <Lines text="footnote" className="mt-2" widths={["96%", "40%"]} />
    </section>
  );
}

/** The week strip (components/timeline/week-strip.tsx): letter, then a 34px day circle. */
export function WeekStripSkeleton() {
  return (
    <div aria-hidden="true" className="mt-2.5 grid grid-cols-7 text-center">
      {Array.from({ length: 7 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder days
        <span key={i} className="flex flex-col items-center gap-0.5 py-1">
          <Lines text="caption" widths={["0.6rem"]} />
          <span className="grid size-[34px] place-items-center text-body">
            <Lines text="body" widths={["1.1rem"]} />
          </span>
        </span>
      ))}
    </div>
  );
}

/** The day's heading, its summary paragraph and the key (app/timeline/page.tsx, TimelineKey). */
export function DaySummarySkeleton() {
  return (
    <>
      {/* Most visits open on today, so the "Today" line is there (app/timeline/page.tsx). */}
      <div className="mt-4">
        <Lines text="footnote" widths={["2.6rem"]} />
        <Lines text="title3" widths={["13rem"]} />
      </div>
      <Lines text="subhead" className="mt-1" widths={["100%", "96%", "100%", "18%"]} />
      <div aria-hidden="true" className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
        {["4.2rem", "2rem", "2.6rem", "3.4rem", "4.6rem"].map((w) => (
          <span key={w} className="flex items-center gap-1.5">
            <Bone className="h-3 w-4 rounded-[3px]" />
            <Lines text="footnote" widths={[w]} />
          </span>
        ))}
      </div>
    </>
  );
}

// components/timeline/day-timeline.tsx: PER_HOUR 56px; labels in a 50px gutter.
const PER_HOUR = 56;
const QUIET = 32;

/** The hour grid with a few grey blocks (components/timeline/day-timeline.tsx). */
export function HourGridSkeleton({ hours = 10 }: { hours?: number }) {
  return (
    <div aria-hidden="true" className="relative mt-3" style={{ height: QUIET + hours * PER_HOUR }}>
      {/* The night before the first screen, collapsed into one quiet band. */}
      <Bone className="absolute inset-x-0 top-[3px]" style={{ height: QUIET - 6 }} />
      {Array.from({ length: hours }, (_, h) => QUIET + h * PER_HOUR).map((top) => (
        <span key={top} className="absolute inset-x-0 flex items-center gap-2" style={{ top: top - 6 }}>
          <Lines text="caption" widths={["1.9rem"]} />
          <span className="h-[0.5px] flex-1 bg-separator" />
        </span>
      ))}
      <Bone className="absolute top-[62px] right-4 left-[50px] h-[90px]" />
      <Bone className="absolute top-[162px] right-4 left-[50px] h-[50px]" />
      <Bone className="absolute top-[222px] right-4 left-[50px] h-[76px]" />
      <Bone className="absolute top-[380px] right-4 left-[50px] h-[110px]" />
    </div>
  );
}

/* ---------- Goals (app/goals/page.tsx) ---------- */

/**
 * The answer (app/goals/page.tsx, Hero): the goal that needs you most in the insight size, the
 * large bar and its line, then the one action card.
 */
export function GoalsTopSkeleton() {
  return (
    <section aria-hidden="true" className="mt-3">
      <Lines text="insight" widths={["100%", "62%"]} />
      <div className="mt-5">
        <Bone className="h-3 w-full rounded-full" />
        <Lines text="footnote" className="mt-2.5" widths={["13rem"]} />
      </div>
      <Group rounded="card" className="mt-5 flex flex-col gap-1.5 px-4 pt-3.5 pb-4">
        <Lines text="body" widths={["11rem"]} />
        <Lines text="subhead" widths={["96%", "70%"]} />
        <Lines text="subhead" widths={["9rem"]} />
        <Bone className="mt-1.5 h-9 w-30 rounded-full" />
      </Group>
    </section>
  );
}

/** One goal row (app/goals/page.tsx, GoalRow): title and time left, the bar, one line. */
function GoalRowSkeleton({ first }: { first: boolean }) {
  return (
    <div className="relative px-4 pt-3 pb-3.5">
      {first ? null : <RowRule />}
      <div className="flex items-baseline justify-between gap-3">
        <Lines text="body" widths={["8rem"]} />
        <Lines text="subhead" widths={["4.2rem"]} />
      </div>
      <Bone className="mt-2.5 h-1.5 w-full rounded-full" />
      <Lines text="footnote" className="mt-2" widths={["15rem"]} />
    </div>
  );
}

/** One area of goals (app/goals/page.tsx): heading with its hours, then its goal rows. */
export function GoalGroupSkeleton({ rows = 2, title = "6.5rem" }: { rows?: number; title?: string }) {
  return (
    <section aria-hidden="true" className="mt-6">
      <SectionTitle width={title} right="4.5rem" />
      <Group>
        {Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
          <GoalRowSkeleton key={i} first={i === 0} />
        ))}
      </Group>
    </section>
  );
}

/* ---------- Agents (app/agents/page.tsx) ---------- */

/** The headline: who asked about you today, in the insight size. */
export function AgentsHeadlineSkeleton() {
  return <Lines text="insight" className="mt-1.5" widths={["100%", "96%", "34%"]} />;
}

/**
 * Who asked today (components/agents/query-log.tsx): one card per agent, a header with its
 * initial, then the day's questions on a thin time line.
 */
export function AgentsLogSkeleton({ agents = [4, 2] }: { agents?: number[] }) {
  return (
    <section aria-hidden="true" className="mt-6">
      <SectionTitle width="10rem" />
      <div className="flex flex-col gap-3">
        {agents.map((n, a) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder agents
          <Group key={a} className="pb-1.5">
            <div className="flex items-center gap-3 px-4 pt-3 pb-1.5">
              <Bone className="size-[34px] shrink-0 rounded-[9px]" />
              <div className="flex min-w-0 flex-1 flex-col">
                <Lines text="body" widths={["4.5rem"]} />
                <Lines text="footnote" widths={["8.5rem"]} />
              </div>
            </div>
            <ol>
              {Array.from({ length: n }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder questions
                <li key={i} className="relative grid grid-cols-[44px_14px_1fr] gap-x-2 px-4">
                  <span className="pt-[11px]">
                    <Lines text="footnote" widths={["2.3rem"]} />
                  </span>
                  <span className="relative flex justify-center">
                    {i === n - 1 ? null : (
                      <span className="absolute top-[22px] -bottom-[14px] w-px bg-separator" />
                    )}
                    <span className="relative mt-[15px] size-[9px] rounded-full shadow-[inset_0_0_0_1.5px_var(--m-separator)]" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1.5 py-[9px]">
                    <Lines text="subhead" widths={[["11rem", "13rem", "9rem", "12rem"][i % 4] as string]} />
                  </div>
                </li>
              ))}
            </ol>
          </Group>
        ))}
      </div>
    </section>
  );
}

/** What they can do (components/agents/agent-row.tsx): one row per allowed agent. */
export function AgentRowsSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <section aria-hidden="true" className="mt-6">
      <SectionTitle width="10.5rem" />
      <Group>
        {Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
          <div key={i} className="relative flex min-h-[60px] items-center gap-3 px-4 py-2.5">
            {i > 0 ? <RowRule inset={64} /> : null}
            <Bone className="size-[34px] shrink-0 rounded-[9px]" />
            <span className="flex min-w-0 flex-1 flex-col">
              <Lines text="body" widths={["5rem"]} />
              <Lines text="footnote" widths={["70%"]} />
            </span>
            <Bone className="size-4 rounded-full" />
          </div>
        ))}
      </Group>
    </section>
  );
}

/* ---------- You (app/you/page.tsx) ---------- */

/** How many rows the Connections list shows: one per connection, all eight. */
const CONNECTION_COUNT = Object.keys(CONNECTOR_STATUS).length;

/**
 * Connections (components/you/connections-list.tsx): heading and summary, one row per live
 * connection (icon, name, status line, a Manage pill).
 */
export function ConnectionRowsSkeleton({
  rows = CONNECTION_COUNT,
  heading = true,
}: {
  rows?: number;
  heading?: boolean;
}) {
  return (
    <section aria-hidden="true" className="mt-6">
      {heading ? (
        <>
          <Lines text="title3" widths={["8.5rem"]} />
          <Lines text="subhead" className="mt-1 mb-3" widths={["10rem"]} />
        </>
      ) : null}
      <Group>
        {Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
          <div key={i} className="relative flex min-h-16 items-center gap-3 pr-4">
            {i > 0 ? <RowRule inset={52} /> : null}
            <div className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4">
              <Bone className="size-6 shrink-0 rounded-[6px]" />
              <span className="flex min-w-0 flex-col">
                <Lines text="body" widths={[["8.5rem", "6.5rem", "3rem", "8rem"][i % 4] as string]} />
                <Lines text="footnote" widths={["11.5rem"]} />
              </span>
            </div>
            <Bone className="h-9 w-[104px] shrink-0 rounded-full" />
          </div>
        ))}
      </Group>
    </section>
  );
}

/** Privacy on You: the off the record switch and its note. */
export function PrivacySkeleton() {
  return (
    <section aria-hidden="true" className="mt-8">
      <SectionTitle width="4.5rem" />
      <Group>
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
          <span className="flex flex-col">
            <Lines text="body" widths={["7.5rem"]} />
            <Lines text="footnote" widths={["12rem"]} />
          </span>
          <Bone className="h-[31px] w-[51px] rounded-full" />
        </div>
      </Group>
      <Lines text="footnote" className="mt-2 px-4" widths={["100%", "70%"]} />
    </section>
  );
}

/** A connection's setup page (components/you/connection-page.tsx): what it gives, its status. */
export function ConnectionPageSkeleton() {
  return (
    <>
      <Lines text="subhead" className="mt-1" widths={["100%", "45%"]} />
      <Group className="mt-4 px-4 py-3">
        <Lines text="subhead" widths={["70%"]} />
      </Group>
      <div aria-hidden="true" className="mt-6 flex flex-col gap-6">
        {/* Set up (components/setup/parts.tsx, Card and PrimaryButton), then its note. */}
        <section>
          <SectionTitle width="4.5rem" />
          <Group className="p-4">
            <Lines text="body" widths={["11rem"]} />
            <Lines text="subhead" className="mt-1" widths={["96%", "90%", "40%"]} />
            <Bone className="mt-2 h-11 w-full rounded-full" />
          </Group>
          <Lines text="footnote" className="mt-2 px-4" widths={["100%", "92%", "40%"]} />
        </section>
        {/* What I read (components/you/source-privacy.tsx): one switch row and its note. */}
        <section>
          <SectionTitle width="7rem" />
          <Group>
            <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
              <span className="flex flex-col">
                <Lines text="body" widths={["7rem"]} />
                <Lines text="footnote" widths={["11rem"]} />
              </span>
              <Bone className="h-[31px] w-[51px] shrink-0 rounded-full" />
            </div>
          </Group>
          <Lines text="footnote" className="mt-2 px-4" widths={["100%", "60%"]} />
        </section>
      </div>
    </>
  );
}

/* ---------- Chat (app/chat/page.tsx) ---------- */

/**
 * A conversation (app/chat/chat.tsx, message-bubble.tsx): bubbles at 85% at most, yours on the
 * right, Michael's on the left, 8px apart. Bubbles are as tall as their lines: 8px padding each
 * side of 22px body lines.
 */
export function ChatHistorySkeleton({
  bubbles = [
    { mine: false, lines: ["15rem", "9rem"] },
    { mine: false, lines: ["13rem", "15rem", "6rem"] },
    { mine: true, lines: ["11rem"] },
    { mine: false, lines: ["14rem", "8rem"] },
  ],
}: {
  bubbles?: { mine: boolean; lines: string[] }[];
}) {
  return (
    <ol aria-hidden="true" className="flex flex-col gap-2 pt-4">
      {bubbles.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder bubbles
        <li key={i} className={`flex flex-col ${b.mine ? "items-end" : "items-start"}`}>
          <Group rounded="card" className="max-w-[85%] px-3.5 py-2">
            <Lines text="body" widths={b.lines} />
          </Group>
        </li>
      ))}
    </ol>
  );
}

/**
 * Michael's check in at the top of Chat (components/chat/check-in.tsx): his two lines, the 1 to 5
 * buttons, the own words field and the note. Shown on every first visit of the day.
 */
export function CheckInSkeleton() {
  return (
    <section aria-hidden="true" className="pt-4">
      <div className="flex flex-col gap-2">
        <Group rounded="card" className="max-w-[85%] self-start px-3.5 py-2">
          <Lines text="body" widths={["14.5rem", "7.5rem"]} />
        </Group>
        <Group rounded="card" className="max-w-[85%] self-start px-3.5 py-2">
          <Lines text="body" widths={["15.5rem", "5rem"]} />
        </Group>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <Bone key={n} className="size-11 rounded-full" />
          ))}
        </div>
        <Group rounded="card" className="flex items-center gap-2 p-1.5 pl-4">
          <span className="flex min-h-9 flex-1 items-center">
            <Lines text="body" widths={["9.5rem"]} />
          </span>
          <span className="flex h-9 items-center px-3">
            <Lines text="subhead" widths={["3.3rem"]} />
          </span>
        </Group>
      </div>
      <Lines text="footnote" className="mt-3" widths={["18rem"]} />
    </section>
  );
}

/** The message field at the foot of Chat (app/chat/chat.tsx): field, mic and Send. */
export function ComposerSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="sticky bottom-[calc(var(--m-tabbar-h)+24px+env(safe-area-inset-bottom))] z-10 mt-4 bg-bg pt-2 pb-0.5 lg:bottom-6"
    >
      <Group rounded="card" className="flex items-end gap-2 p-1.5 pl-4">
        <span className="flex min-h-9 flex-1 items-center py-1.5">
          <Lines text="body" widths={["6rem"]} />
        </span>
        <Bone className="size-9 shrink-0 rounded-full" />
        <Bone className="h-9 w-[66px] shrink-0 rounded-full" />
      </Group>
    </div>
  );
}

/* ---------- Shared ---------- */

/** An inset group of plain rows (title and one line), at the real 44 to 60px row heights. */
export function RowsSkeleton({ rows = 3, inset = 16 }: { rows?: number; inset?: number }) {
  return (
    <Group>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
        <div key={i} className="relative flex min-h-14 flex-col justify-center px-4 py-2">
          {i > 0 ? <RowRule inset={inset} /> : null}
          <Lines text="body" widths={[["9rem", "7rem", "11rem"][i % 3] as string]} />
          <Lines text="footnote" widths={["65%"]} />
        </div>
      ))}
    </Group>
  );
}

/**
 * A sheet that loads its data (components/sheet.tsx): its title row stays real; this fills the
 * body with a short paragraph and rows until the data lands.
 */
export function SheetBodySkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <Lines text="subhead" widths={["100%", "62%"]} />
      <RowsSkeleton rows={rows} />
    </div>
  );
}

/* ---------- What I know about you (app/you/knowledge/page.tsx) ---------- */

/** The intro, then "Things you told me" (told-list.tsx) and "What I read": real titles, bones for rows. */
export function KnowledgeSkeleton() {
  return (
    <div aria-hidden="true">
      <Lines text="subhead" className="mt-1" widths={["100%", "55%"]} />
      <section className="mt-6">
        <h2 className="mb-2 text-title3 font-bold">Things you told me</h2>
        <Lines text="footnote" className="px-4 pb-1.5" widths={["7rem"]} />
        <RowsSkeleton rows={3} />
      </section>
      <section className="mt-8">
        <h2 className="mb-2 text-title3 font-bold">What I read</h2>
        <RowsSkeleton rows={2} />
      </section>
    </div>
  );
}
