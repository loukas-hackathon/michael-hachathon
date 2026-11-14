import type { AgentScope } from "@michael/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agentsStore } from "./agents-store";
import { currentAgent } from "./context";

// Michael for agents (#38) on MCP: every tool checks the calling agent's scopes and every call
// is logged ("who asked about me today"). Applied by wrapping registerTool, so a tool added to
// mcp.ts later is covered without touching this file. API key callers (our own tools) carry no
// agent and pass straight through.

/** Which scope a tool needs. Unlisted tools: read only ones need `timeline`, the rest `write_events`. */
export const TOOL_SCOPE: Record<string, AgentScope> = {
  get_timeline: "timeline",
  get_patterns: "timeline",
  get_goals: "goals",
  get_recommendations: "recommendations",
  get_score: "score",
  add_event: "write_events",
  plan_travel: "write_events",
};

type ToolConfig = { title?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } };

export const scopeFor = (name: string, config: ToolConfig): AgentScope =>
  TOOL_SCOPE[name] ?? (config.annotations?.readOnlyHint ? "timeline" : "write_events");

const hhmm = (iso: unknown) =>
  typeof iso === "string" && !Number.isNaN(Date.parse(iso))
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Athens",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(iso))
    : null;

/** One plain line for the Agents screen, in Michael's voice. Never the full payload. */
export function summarise(name: string, title: string | undefined, input: unknown): string {
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const from = hhmm(a.from);
  const to = hhmm(a.to);
  const range = from && to ? ` from ${from} to ${to}` : from ? ` from ${from}` : "";
  switch (name) {
    case "get_timeline":
      return `Read your day${range}`;
    case "get_patterns":
      return `Read your patterns${range}`;
    case "get_goals":
      return "Read your goals";
    case "get_recommendations":
      return "Read my advice";
    case "get_score":
      return typeof a.date === "string" ? `Read your score for ${a.date}` : "Read your score";
    case "add_event":
      return typeof a.title === "string"
        ? `Added "${a.title.slice(0, 80)}" to your day`
        : "Added to your day";
    case "plan_travel":
      return `Planned your drives${range}`;
    default:
      return title ?? name;
  }
}

const SCOPE_WORDS: Record<AgentScope, string> = {
  timeline: "their day",
  goals: "their goals",
  recommendations: "Michael's advice",
  score: "their score",
  write_events: "adding to their day",
};

type Callback = (...args: unknown[]) => unknown;

export function guardTools(server: McpServer): void {
  const register = server.registerTool.bind(server) as unknown as (
    n: string,
    c: ToolConfig,
    cb: Callback,
  ) => unknown;
  const guarded = (name: string, config: ToolConfig, cb: Callback) =>
    register(name, config, async (...args: unknown[]) => {
      const agent = currentAgent();
      if (!agent) return cb(...args);
      const scope = scopeFor(name, config);
      const allowed = agent.status === "approved" && agent.scopes.includes(scope);
      const input = config.inputSchema ? args[0] : undefined;
      try {
        await agentsStore.logQuery({
          agent_id: agent.id,
          tool: name,
          summary: summarise(name, config.title, input),
          allowed,
        });
      } catch (err) {
        console.error("agent query log failed", err);
      }
      if (!allowed) {
        const why =
          agent.status === "approved"
            ? `The user has not shared ${SCOPE_WORDS[scope]} with ${agent.name}.`
            : `${agent.name} is not approved yet.`;
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Not allowed. ${why} They can change this in Michael, under Agents.`,
            },
          ],
        };
      }
      return cb(...args);
    });
  (server as unknown as { registerTool: typeof guarded }).registerTool = guarded;
}
