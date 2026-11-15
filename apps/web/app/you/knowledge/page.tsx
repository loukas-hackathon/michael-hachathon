import type { Knowledge, KnowledgeSource } from "@michael/shared";
import Link from "next/link";
import { CONNECTIONS } from "@/lib/connections";
import { ago } from "@/lib/connections-status";
import { getKnowledge } from "@/lib/knowledge";
import { SourceSwitches } from "../source-switches";
import { ToldList } from "./told-list";

export const metadata = { title: "What I know about you · Michael" };

const sectionTitle = "mb-2 text-title3 font-bold";

/**
 * Each source's row: what it sends leads, then which source and when its last data came. The
 * source's name is left out when it is the connection's own, so nothing is said twice.
 */
function readLabel(r: KnowledgeSource, connection: string): [string, string] {
  const state = !r.collecting ? "Off" : r.last_event_at ? `Last data ${ago(r.last_event_at)}` : "No data yet";
  return [r.sends, r.name === connection ? state : `${r.name}. ${state}`];
}

/** The connections that read something, each with the switches of its sources. */
function readGroups(reads: KnowledgeSource[]) {
  const groups = CONNECTIONS.map((c) => ({
    name: c.name,
    href: c.href as string | null,
    sources: reads.filter((r) => c.sources.includes(r.source)),
  })).filter((g) => g.sources.length);
  const owned = new Set(CONNECTIONS.flatMap((c) => c.sources));
  const other = reads.filter((r) => !owned.has(r.source));
  if (other.length) groups.push({ name: "Other", href: null, sources: other });
  return groups;
}

function WhatIRead({ k }: { k: Knowledge }) {
  const groups = readGroups(k.reads);
  return (
    <section className="mt-8">
      <h2 className={sectionTitle}>What I read</h2>
      {k.off_the_record ? (
        <p className="mb-3 rounded-group bg-fill px-4 py-3 text-subhead text-label-2">
          Off the record. I am reading nothing right now.
        </p>
      ) : null}
      {groups.length ? (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.name}>
              {g.href ? (
                <Link
                  href={g.href}
                  className="press flex min-h-11 items-end justify-between px-4 pb-1.5 text-footnote font-semibold text-label-2"
                >
                  {g.name}
                  <span aria-hidden="true">›</span>
                </Link>
              ) : (
                <h3 className="px-4 pb-1.5 text-footnote font-semibold text-label-2">{g.name}</h3>
              )}
              <SourceSwitches
                initial={g.sources.map((s) => ({
                  source: s.source,
                  // A source never switched that is sending is on: its first event was the opt in.
                  enabled: s.enabled || (s.collecting && s.last_event_at !== null),
                  updated_at: new Date(0).toISOString(),
                }))}
                sources={g.sources.map((s) => s.source)}
                labels={Object.fromEntries(g.sources.map((s) => [s.source, readLabel(s, g.name)]))}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-group bg-fill px-4 py-3 text-subhead text-label-2">
          Nothing yet.{" "}
          <Link href="/you#connections" className="font-semibold text-tint-text">
            Connect something
          </Link>{" "}
          and it shows here.
        </p>
      )}
      <p className="mt-2 px-4 text-footnote text-label-2">Switch one off and I stop reading it at once.</p>
    </section>
  );
}

// What I know about you (#379): everything Michael uses, in plain words, under You > Privacy.
// Four questions in order: what did I tell him, what does he read, what does he never keep, who
// else asked. Each item can be forgotten here; each connection's switch is here too.
export default async function KnowledgePage() {
  const k = await getKnowledge();
  const asked = k?.asked_today ?? 0;

  return (
    <main className="screen">
      <header className="flex min-h-11 items-center pt-2">
        <Link
          href="/you"
          className="press -ml-2 flex h-11 items-center gap-1 px-2 text-body font-semibold text-tint-text"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
            <path
              d="m15 5-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          You
        </Link>
      </header>
      <h1 className="text-large-title font-bold tracking-[0.01em]">What I know about you</h1>
      <p className="mt-1 text-subhead text-label-2">
        Everything I use to coach you. Forget something and it is gone from the database.
      </p>

      {k ? (
        <>
          <section className="mt-6">
            <h2 className={sectionTitle}>Things you told me</h2>
            <ToldList items={k.told} />
          </section>

          <WhatIRead k={k} />

          <section className="mt-8">
            <h2 className={sectionTitle}>What I never keep</h2>
            <ul className="overflow-hidden rounded-group bg-fill">
              {k.never_kept.map((line, i) => (
                <li key={line} className="relative flex min-h-12 items-center px-4 py-2.5 text-subhead">
                  {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
                  {line}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8">
            <h2 className={sectionTitle}>Who asked about you</h2>
            <Link
              href="/agents"
              className="press flex min-h-14 items-center justify-between gap-3 rounded-group bg-fill px-4 py-2"
            >
              <span className="flex flex-col">
                <span className="text-body">Agents</span>
                <span className="text-footnote text-label-2 tnum">
                  {asked
                    ? `Asked ${asked} ${asked === 1 ? "time" : "times"} today. Every question is logged.`
                    : k.agents_connected
                      ? "No one asked today. Every question is logged."
                      : "None connected. Every question would be logged."}
                </span>
              </span>
              <span aria-hidden="true" className="text-label-2">
                ›
              </span>
            </Link>
          </section>
        </>
      ) : (
        <p role="alert" className="mt-6 rounded-group bg-fill px-4 py-3 text-subhead text-label-2">
          I couldn't load this. Pull to refresh.
        </p>
      )}
    </main>
  );
}
