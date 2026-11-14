import { AgentClientUpdate, type AgentQuery, IsoDateTime } from "@michael/shared";
import { Hono } from "hono";
import { z } from "zod";
import { undoDeadline } from "../actions/calendar";
import { agentsStore } from "../agents-store";
import { currentUserId } from "../context";
import { HttpError, jsonBody, parse } from "../http";
import { UNDOABLE_TOOLS } from "../mcp-guard";
import { oauthStore } from "../oauth-store";
import { store } from "../store";
import { forgetTokens } from "./oauth";

// Michael for agents (#38): who may ask about the user, within which scopes, and every question
// they asked. Agents are created by the OAuth consent tap (routes/oauth.ts); MCP calls are
// checked and logged in mcp-guard.ts.

/** Local midnight today in Europe/Athens, as an ISO instant with offset. */
export function athensMidnight(now = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(now);
  const offset =
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Athens", timeZoneName: "longOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")
      ?.value.replace("GMT", "") || "Z";
  return new Date(`${day}T00:00:00${offset}`).toISOString();
}

/** Until when each change an agent made can still be undone: done, and its deadline not passed. */
async function withUndo(queries: AgentQuery[]): Promise<AgentQuery[]> {
  const undoable = (q: AgentQuery) => Boolean(q.recommendation_id && UNDOABLE_TOOLS.has(q.tool));
  const ids = [...new Set(queries.filter(undoable).map((q) => q.recommendation_id as string))];
  const until = new Map<string, string | null>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const rec = await store.getRecommendation(id);
        const deadline = rec?.status === "done" ? await undoDeadline(id) : null;
        until.set(id, deadline && Date.parse(deadline) > Date.now() ? deadline : null);
      } catch {
        until.set(id, null);
      }
    }),
  );
  return queries.map((q) => ({
    ...q,
    undo_until: undoable(q) ? (until.get(q.recommendation_id as string) ?? null) : null,
  }));
}

const QueriesQuery = z.object({ from: IsoDateTime.optional(), to: IsoDateTime.optional() });

export const agents = new Hono()
  .get("/agents", async (c) => c.json({ agents: await agentsStore.listAgents() }))
  // Before /agents/:id so "queries" is never read as an id.
  .get("/agents/queries", async (c) => {
    const q = parse(QueriesQuery, c.req.query());
    const to = q.to ?? new Date().toISOString();
    const from = q.from ?? athensMidnight();
    if (Date.parse(from) > Date.parse(to)) throw new HttpError("bad_request", "`from` must be before `to`");
    return c.json({ queries: await withUndo(await agentsStore.listQueries({ from, to })) });
  })
  .patch("/agents/:id", async (c) => {
    const id = c.req.param("id");
    if (!z.uuid().safeParse(id).success) throw new HttpError("not_found", "Agent not found");
    const patch = parse(AgentClientUpdate, await jsonBody(c));
    const agent = await agentsStore.updateAgent(id, patch);
    if (!agent) throw new HttpError("not_found", "Agent not found");
    if (agent.status === "revoked") {
      // Revoked means it sees nothing from now on: its tokens die with it.
      await oauthStore.revokeAgentTokens(currentUserId(), agent.id);
      forgetTokens();
    }
    return c.json(agent);
  });
