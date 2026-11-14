import type { AgentScope } from "@michael/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agentsStore } from "./agents-store";
import { currentAgent } from "./context";
import { toInstant } from "./mcp-format";

// Michael for agents (#38) on MCP: every tool checks the calling agent's scopes and every call
// is logged ("who asked about me today"). Applied by wrapping registerTool, so a tool added to
// mcp.ts later is covered without touching this file. API key callers (our own tools) carry no
// agent and pass straight through.

/** Which scope a tool needs. Unlisted tools: read only ones need `timeline`, the rest `write_events`. */
// Changing the calendar or the timeline needs `write_events`; keeping goals needs `goals`;
// answering Michael's advice needs `recommendations`.
export const TOOL_SCOPE: Record<string, AgentScope> = {
  get_timeline: "timeline",
  get_patterns: "timeline",
  get_goals: "goals",
  get_instructions: "goals",
  propose_goals: "goals",
  add_goal: "goals",
  update_goal: "goals",
  list_recommendations: "recommendations",
  update_recommendation: "recommendations",
  get_nudges: "recommendations",
  get_score: "score",
  get_records: "score",
  get_moments: "score",
  add_event: "write_events",
  execute_recommendation: "write_events",
  undo_recommendation: "write_events",
  create_focus_block: "write_events",
  block_mac_app: "write_events",
  suggest_app_mute: "recommendations",
  plan_travel: "write_events",
};

type ToolConfig = { title?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } };

export const scopeFor = (name: string, config: ToolConfig): AgentScope =>
  TOOL_SCOPE[name] ?? (config.annotations?.readOnlyHint ? "timeline" : "write_events");

const hhmm = (value: unknown) => {
  const iso = typeof value === "string" ? instant(value) : null;
  return iso
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Athens",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(iso))
    : null;
};

// Tool times may be Europe/Athens wall time without an offset (mcp-format.ts).
function instant(value: string): string | null {
  try {
    return toInstant(value);
  } catch {
    return null;
  }
}

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
    case "get_instructions":
      return "Read your standing instructions";
    case "propose_goals":
      return "Read the goals your calendar suggests";
    case "list_recommendations":
      return "Read my advice";
    case "get_nudges":
      return "Read your nudges";
    case "get_moments":
      return a.kind === "evening" ? "Read your evening moment" : "Read your morning moment";
    case "add_goal":
      return typeof a.title === "string" ? `Added the goal "${a.title.slice(0, 80)}"` : "Added a goal";
    case "update_goal":
      return a.active === false ? "Paused one of your goals" : "Changed one of your goals";
    case "update_recommendation":
      return a.status === "dismissed" ? "Dismissed my advice" : "Accepted my advice";
    case "execute_recommendation":
      return "Carried out my advice on your calendar";
    case "undo_recommendation":
      return "Undid a change on your calendar";
    case "plan_travel":
      return `Planned your drives${range}`;
    case "create_focus_block": {
      const what = typeof a.title === "string" ? `"${a.title.slice(0, 80)}"` : "a focus block";
      const start = hhmm(a.start);
      return start ? `Booked ${what} for ${start}` : `Booked ${what}`;
    }
    case "block_mac_app": {
      const apps = Array.isArray(a.apps) ? a.apps.filter((x) => typeof x === "string").slice(0, 3) : [];
      const end = hhmm(a.end);
      const what = apps.length ? apps.join(", ") : "apps";
      return end ? `Muted ${what} on your Mac until ${end}` : `Muted ${what} on your Mac`;
    }
    case "suggest_app_mute":
      return "Suggested muting an app";
    case "get_score":
      return typeof a.date === "string" ? `Read your score for ${a.date}` : "Read your score";
    case "get_records":
      return "Read your personal records";
    case "add_event":
      return typeof a.title === "string"
        ? `Added "${a.title.slice(0, 80)}" to your day`
        : "Added to your day";
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
