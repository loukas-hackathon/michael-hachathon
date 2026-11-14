import { AgentRow } from "@/components/agents/agent-row";
import { ApprovalCard } from "@/components/agents/approval-card";
import { ConnectClaude } from "@/components/agents/connect-claude";
import { ScreenHeader } from "@/components/screen";
import { getAgents, SCOPE_LABEL, whoAsked } from "@/lib/agents";
import { MCP_URL } from "@/lib/connect";
import { formatTime } from "@/lib/format";

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  const view = await getAgents(demo);
  const pending = view.agents.filter((a) => a.status === "pending");
  const allowed = view.agents.filter((a) => a.status === "approved");
  const asked = whoAsked(view);
  const nameOf = (id: string) => view.agents.find((a) => a.id === id)?.name ?? "An agent";

  return (
    <main className="screen">
      <ScreenHeader context="Who asks about you" title="Agents" />

      {view.agents.length === 0 ? (
        // Nothing to approve yet, so connecting Claude is the one thing to do here: put it first.
        <>
          <ConnectClaude url={MCP_URL} />
          <p className="mt-2 px-4 text-footnote text-label-2">
            Once Claude is connected, every question it asks about you shows here, and you approve it with one
            tap.
          </p>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-subhead text-label-2">
            {asked.length ? (
              <>
                Who asked about you today: <b className="font-semibold text-label">{asked.join(", and ")}.</b>
              </>
            ) : (
              "Nobody has asked about you today."
            )}{" "}
            I answer only within what you allow.
          </p>

          {pending.map((a) => (
            <ApprovalCard
              key={a.id}
              id={a.id}
              name={a.name}
              wants={a.scopes.includes("timeline") ? "when you're in deep work." : "about your goals."}
              scopes={a.scopes.map((s) => SCOPE_LABEL[s])}
            />
          ))}

          {allowed.length ? (
            <section className="mt-6">
              <h2 className="mb-2 text-title3 font-bold">Allowed</h2>
              <div className="overflow-hidden rounded-group bg-fill">
                {allowed.map((a, i) => (
                  <div key={a.id} className="relative">
                    {i > 0 ? (
                      <span className="absolute inset-x-0 top-0 ml-16 h-[0.5px] bg-separator" />
                    ) : null}
                    <AgentRow
                      id={a.id}
                      name={a.name}
                      lastAsked={a.last_seen_at ? formatTime(a.last_seen_at) : null}
                      scopes={(Object.keys(SCOPE_LABEL) as (keyof typeof SCOPE_LABEL)[]).map((k) => ({
                        key: k,
                        label: SCOPE_LABEL[k],
                        on: a.scopes.includes(k),
                      }))}
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {view.queries.length ? (
            <section className="mt-6">
              <h2 className="mb-2 text-title3 font-bold">Today</h2>
              <ol className="overflow-hidden rounded-group bg-fill">
                {view.queries.map((q, i) => (
                  <li key={q.id} className="relative px-4 py-2.5">
                    {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-subhead">
                        <time className="font-semibold tnum" dateTime={q.created_at}>
                          {formatTime(q.created_at)}
                        </time>{" "}
                        {nameOf(q.agent_id)}
                      </p>
                      <p className="shrink-0 text-footnote text-label-2">
                        {q.allowed ? "Shared" : "Not shared"}
                      </p>
                    </div>
                    <p className="text-footnote text-label-2">{q.summary}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      )}

      {view.agents.length > 0 ? <ConnectClaude url={MCP_URL} /> : null}

      {view.sample ? (
        <p className="mt-8 text-footnote text-label-2">
          Sample agents. Real requests appear once Claude is connected.
        </p>
      ) : null}
    </main>
  );
}
