import type { Metadata } from "next";
import { Wordmark } from "@/components/brand";
import { getScore, getToday } from "@/lib/api";
import { type DayView, nowIndex, tape, totals } from "@/lib/day";
import { formatDay, formatTime, hm, minutesPhrase } from "@/lib/format";
import { getStageFeed } from "@/lib/stage";
import { StageLive } from "./stage-live";
import { StageTape } from "./stage-tape";
import "./stage.css";

export const metadata: Metadata = { title: "Michael on stage" };

/**
 * The big screen for the pitch: a 16:9 frame with the score, today's tape and the latest nudge,
 * live. Signed in as the demo account or the current user, like every screen. Press N to send a
 * test nudge to the watch and see it land here at the same moment.
 * ?demo=sample|morning|evening|empty previews states; ?theme=light for a light room.
 */
export default async function StagePage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string; theme?: string }>;
}) {
  const { demo, theme } = await searchParams;
  const [day, feed, score] = await Promise.all([
    getToday(demo).catch(() => null),
    getStageFeed(),
    // The same score Today is built from (deduped per request), for each block's own title.
    demo ? Promise.resolve(null) : getScore().catch(() => null),
  ]);
  // A block is named as the calendar names it ("Rhefuel"), as on Today and Timeline, not by its goal.
  const titles = new Map((score?.day.blocks ?? []).map((b) => [b.event_id, b.title]));

  return (
    <main className="stage" data-theme={theme === "light" ? "light" : "dark"}>
      <StageLive
        initial={feed}
        header={
          <header className="stage-header">
            <Wordmark className="stage-wordmark" />
            <p>
              {formatDay(day?.now ?? new Date())}
              {day?.sample ? " · Sample day" : ""}
            </p>
          </header>
        }
        hero={<Hero day={day} />}
        tape={<Band day={day} titles={titles} />}
      />
    </main>
  );
}

function Hero({ day }: { day: DayView | null }) {
  if (!day) {
    return (
      <section className="stage-score">
        <p className="stage-score-first">Today is not in yet.</p>
        <p className="stage-won">I couldn't reach your day. The nudges still land here.</p>
      </section>
    );
  }
  const t = totals(day);
  const first = day.blocks[0];
  if (!first) {
    return (
      <section className="stage-score">
        <p className="stage-score-first">Nothing planned today.</p>
        <p className="stage-won">Give a goal a block on your calendar and I will count it here.</p>
      </section>
    );
  }
  if (t.scorePct === null) {
    return (
      <section className="stage-score">
        <p className="stage-score-first">
          Your first block starts at <span className="tnum">{formatTime(first.start)}</span>.
        </p>
        <p className="stage-won stage-won-plain">
          <b className="tnum">{hm(t.planned)}</b> of goal time planned today.
        </p>
      </section>
    );
  }
  return (
    <section className="stage-score" aria-label="Goal time today">
      <h1 className="flex flex-col">
        <span className="stage-score-label">Optimisation score</span>
        <span className="stage-score-number tnum">{t.scorePct}%</span>
        <span className="stage-score-line">
          of your goal time {day.moment === "evening" ? "today" : "so far"}.
        </span>
      </h1>
      {day.wonBackMinutes > 0 ? (
        <p className="stage-won">
          <b className="tnum">{minutesPhrase(day.wonBackMinutes)}</b> won back today.
        </p>
      ) : (
        <p className="stage-won stage-won-plain">
          <b className="tnum">{hm(t.spent)}</b> spent on your goals of <b className="tnum">{hm(t.planned)}</b>{" "}
          planned.
        </p>
      )}
    </section>
  );
}

function Band({ day, titles }: { day: DayView | null; titles: Map<string, string> }) {
  if (!day || day.blocks.length === 0) {
    return (
      <section aria-label="Today" className="stage-empty">
        {day ? "Your day's tape appears here once a goal has a block." : ""}
      </section>
    );
  }
  const ticks = tape(day);
  const t = totals(day);
  // Before the first block starts the tape is all outline, as on Today: the headline already says
  // when it starts, so a projector wide row of empty boxes stays off the stage.
  if (t.scorePct === null) return <section aria-label="Today" className="stage-empty" />;
  const nowAt = day.moment === "evening" ? null : nowIndex(ticks);
  const key = [
    t.spent - t.unverified > 0 ? { kind: "spent", text: `${hm(t.spent - t.unverified)} spent` } : null,
    t.unverified > 0 ? { kind: "unverified", text: `${hm(t.unverified)} unconfirmed` } : null,
    t.lost > 0 ? { kind: "lost", text: `${hm(t.lost)} lost` } : null,
    t.ahead > 0 ? { kind: "ahead", text: `${hm(t.ahead)} ahead` } : null,
  ].filter((k) => k !== null);
  return (
    <section aria-label="Today">
      <StageTape
        ticks={ticks}
        blocks={day.blocks.map((b) => ({ ...b, title: titles.get(b.id) || b.title }))}
        nowAt={nowAt}
        nowLabel={formatTime(day.now)}
        label={`${hm(t.spent)} spent, ${hm(t.lost)} lost, ${hm(t.ahead)} still ahead`}
      />
      <ul className="stage-key tnum">
        {key.map((k) => (
          <li key={k.kind}>
            <i aria-hidden="true" data-kind={k.kind} />
            {k.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
