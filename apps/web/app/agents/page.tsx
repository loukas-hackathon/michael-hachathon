import Link from "next/link";
import { AgentRow } from "@/components/agents/agent-row";
import { ApprovalCard } from "@/components/agents/approval-card";
import { ConnectClaude, ConnectLink } from "@/components/agents/connect-claude";
import { QueryLog } from "@/components/agents/query-log";
import {
  getAgents,
  groupByAgent,
  headline,
  isClaude,
  SCOPE_COPY,
  SCOPE_LABEL,
  SCOPE_ORDER,
} from "@/lib/agents";
import { MCP_URL } from "@/lib/connect";
import { formatDay, formatTime } from "@/lib/format";

const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/**
 * Agents answers three questions, in this order: is anyone waiting for my yes (the one primary
 * action), is Claude connected (if not, connecting it is the hero), and who asked about me today
 * and what did they get. What each agent may do sits below, one sheet per agent.
 */
export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  const view = await getAgents(demo);
  const pending = view.agents.filter((a) => a.status === "pending");
  const allowed = view.agents.filter((a) => a.status === "approved");
  const claude = allowed.find(isClaude);
  const days = groupByAgent(view);
  const { asked, changes } = headline(view);

  return (
    <main className="screen screen-mid">
      <header className="flex min-h-11 items-center pt-2">
        <Link
          href="/you"
          // Laptop: Agents has its own place in the sidebar, so the way back to You hides.
          className="press -ml-2 flex h-11 items-center gap-1 px-2 text-body font-semibold text-tint-text lg:invisible"
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
      <h1 className="text-large-title font-bold tracking-[0.01em]">Agents</h1>

      {/* The answer at a glance: who is connected and who asked, numbers first. */}
      {claude || asked.length ? (
        <p className="mt-1.5 text-insight text-label-2">
          {asked.length ? (
            <>
              {asked.map((a, i) => (
                <span key={a.name}>
                  {i > 0 ? (i === asked.length - 1 ? " and " : ", ") : ""}
                  <b className="font-semibold text-label">{a.name}</b>
                  {i === 0 ? " asked about you " : " "}
                  <b className="font-semibold text-label tnum">{a.times}</b>
                </span>
              ))}{" "}
              today.
              {changes ? (
                <>
                  {" "}
                  <b className="font-semibold text-label tnum">
                    {changes} {changes === 1 ? "change" : "changes"}
                  </b>{" "}
                  to your day.
                </>
              ) : null}
            </>
          ) : (
            <>
              <b className="font-semibold text-label">{claude?.name} is connected.</b> Nobody has asked about
              you today.
            </>
          )}
        </p>
      ) : (
        <p className="mt-1.5 text-subhead text-label-2">AI tools that ask about you, and what they get.</p>
      )}

      {pending.map((a) => (
        <ApprovalCard
          key={a.id}
          id={a.id}
          name={a.name}
          wants={`${list(a.scopes.map((s) => SCOPE_COPY[s].title.toLowerCase()))}.`}
        />
      ))}

      {claude ? null : <ConnectClaude url={MCP_URL} primary={pending.length === 0} />}

      {days.length ? <QueryLog days={days} sample={view.sample} /> : null}

      {allowed.length ? (
        <section aria-labelledby="allowed" className="mt-6">
          <h2 id="allowed" className="mb-2 text-title3 font-bold">
            What they can do
          </h2>
          <div className="overflow-hidden rounded-group bg-fill">
            {allowed.map((a, i) => (
              <div key={a.id} className="relative">
                {i > 0 ? <span className="absolute inset-x-0 top-0 ml-16 h-[0.5px] bg-separator" /> : null}
                <AgentRow
                  id={a.id}
                  name={a.name}
                  since={formatDay(a.created_at)}
                  lastAsked={a.last_seen_at ? formatTime(a.last_seen_at) : null}
                  scopes={SCOPE_ORDER.map((k) => ({
                    key: k,
                    short: SCOPE_LABEL[k],
                    ...SCOPE_COPY[k],
                    on: a.scopes.includes(k),
                  }))}
                />
              </div>
            ))}
          </div>
          <p className="mt-2 px-4 text-footnote text-label-2">
            I answer only within what you allow. Tap an agent to change it or revoke it.
          </p>
        </section>
      ) : null}

      {claude ? <ConnectLink url={MCP_URL} /> : null}

      {view.sample ? (
        <p className="mt-8 text-footnote text-label-2">
          Sample agents. Real requests appear once Claude is connected.
        </p>
      ) : null}
    </main>
  );
}
