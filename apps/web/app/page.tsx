import type { Event, Goal, Recommendation, Source } from "@michael/shared";
import { getGoals, getRecommendations, getTimeline } from "@/lib/api";

const SOURCE_LABEL: Record<Source, string> = {
  omi: "Omi",
  whoop: "WHOOP",
  health_auto_export: "Apple Health",
  ios_shortcuts: "iPhone",
  activitywatch: "Mac",
  google_calendar: "Calendar",
  owntracks: "Location",
  manual: "Manual",
  agent: "Agent",
  macos_usage: "Mac",
  iphone_usage: "iPhone",
  chrome: "Chrome",
  claude_code: "Claude Code",
};

const time = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Athens",
  }).format(new Date(iso));

export default async function Home() {
  const from = "2026-11-14T00:00:00+02:00";
  const to = "2026-11-14T23:59:59+02:00";
  const [timeline, goals, recommendations] = await Promise.all([
    getTimeline(from, to),
    getGoals(),
    getRecommendations(),
  ]);
  const events = [...timeline.events].sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 md:grid-cols-[1fr_340px]">
      <section>
        <header className="mb-8">
          <p className="text-sm text-zinc-500">Saturday 14 November</p>
          <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
        </header>
        <ol className="relative border-l border-zinc-800">
          {events.map((e) => (
            <TimelineItem key={e.id} event={e} />
          ))}
        </ol>
      </section>
      <aside className="space-y-10">
        <Goals goals={goals} />
        <Recommendations items={recommendations} goals={goals} />
      </aside>
    </main>
  );
}

function TimelineItem({ event }: { event: Event }) {
  return (
    <li className="mb-6 ml-6">
      <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-zinc-950 bg-zinc-400" />
      <div className="flex items-baseline gap-3 font-mono text-xs text-zinc-500">
        <span>
          {time(event.start_at)}
          {event.end_at ? ` - ${time(event.end_at)}` : ""}
        </span>
        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">{SOURCE_LABEL[event.source]}</span>
      </div>
      <p className="mt-1 text-zinc-100">{event.title}</p>
    </li>
  );
}

function Goals({ goals }: { goals: Goal[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Goals</h2>
      <ul className="space-y-2">
        {goals.map((g) => (
          <li key={g.id} className="rounded-lg border border-zinc-800 px-3 py-2">
            <span className="mr-2 text-xs text-zinc-500">{g.category}</span>
            {g.title}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Recommendations({ items, goals }: { items: Recommendation[]; goals: Goal[] }) {
  const goalTitle = (id: string | null) => goals.find((g) => g.id === id)?.title;
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Recommendations</h2>
      <ul className="space-y-3">
        {items.map((r) => (
          <li key={r.id} className="rounded-lg border border-zinc-800 p-3">
            <p className="font-medium">{r.title}</p>
            <p className="mt-1 text-sm text-zinc-400">{r.rationale}</p>
            {goalTitle(r.goal_id) && (
              <p className="mt-2 text-xs text-zinc-500">Goal: {goalTitle(r.goal_id)}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
