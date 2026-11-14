import { EventInput, EventType, RecommendationStatus, Source, TravelPlanInput } from "@michael/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { guardTools } from "./mcp-guard";
import { patternReportFor } from "./routes/patterns";
import { travelPlanFor } from "./routes/places";
import { scoreFor } from "./routes/score";
import { store } from "./store";

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "michael", version: "0.1.0" });
  // Agent scopes and the query log apply to every tool registered below (mcp-guard.ts).
  guardTools(server);

  server.registerTool(
    "get_timeline",
    {
      title: "Get timeline",
      description:
        "Return the user's day timeline: timestamped events from all sources (body, attention, speech, calendar, place). Defaults to the last 24 hours.",
      inputSchema: {
        from: z.iso.datetime({ offset: true }).optional().describe("ISO 8601 start, inclusive"),
        to: z.iso.datetime({ offset: true }).optional().describe("ISO 8601 end, inclusive"),
        source: z.array(Source).optional().describe("Only these sources"),
        type: z.array(EventType).optional().describe("Only these event types"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ from, to, source, type }) => {
      const end = to ?? new Date().toISOString();
      const start = from ?? new Date(Date.parse(end) - 24 * 3600_000).toISOString();
      return json({
        from: start,
        to: end,
        events: await store.listEvents({ from: start, to: end, source, type }),
      });
    },
  );

  server.registerTool(
    "get_goals",
    {
      title: "Get goals",
      description: "Return the user's goals (categories: work, gym, rest, food).",
      inputSchema: { active_only: z.boolean().optional().describe("Default true") },
      annotations: { readOnlyHint: true },
    },
    async ({ active_only }) => {
      const goals = await store.listGoals();
      return json({ goals: active_only === false ? goals : goals.filter((g) => g.active) });
    },
  );

  server.registerTool(
    "get_recommendations",
    {
      title: "Get recommendations",
      description: "Return recommendations produced by analysis, each optionally tied to a goal.",
      inputSchema: { status: RecommendationStatus.optional().describe("Filter by status") },
      annotations: { readOnlyHint: true },
    },
    async ({ status }) => json({ recommendations: await store.listRecommendations({ status }) }),
  );

  server.registerTool(
    "get_patterns",
    {
      title: "Get patterns",
      description:
        "Return the patterns found in the user's timeline, with numbers: phone check cadence, focus disruptions and what they cost, repeat offenders, late screens, context switching, time by app and AI tool use. Read `headlines` first. Defaults to the last 7 days.",
      inputSchema: {
        from: z.iso.datetime({ offset: true }).optional().describe("ISO 8601 start"),
        to: z.iso.datetime({ offset: true }).optional().describe("ISO 8601 end"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ from, to }) => json(await patternReportFor({ from, to })),
  );

  server.registerTool(
    "get_score",
    {
      title: "Get score",
      description:
        "Return the user's score: the share of planned goal time actually spent on the goals, for the week and for one day, with time won back, each goal's budget, and the day's blocks with what took the lost time. `unverified_minutes` is spent time the data cannot prove. Defaults to today (Europe/Athens).",
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Local day, YYYY-MM-DD. Default today"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ date }) => json(await scoreFor({ date })),
  );

  server.registerTool(
    "plan_travel",
    {
      title: "Plan travel",
      description:
        "Work out the drives between the user's calendar events with live traffic (Google Maps), put them on the timeline and propose leaving later or moving the user's own block past the rush. Defaults to today (Europe/Athens). Status maps_unavailable or travel_off means nothing was computed.",
      inputSchema: TravelPlanInput.shape,
    },
    async (input) => json(await travelPlanFor(TravelPlanInput.parse(input))),
  );

  server.registerTool(
    "add_event",
    {
      title: "Add event",
      description:
        "Add one event to the user's timeline. Use source 'agent' when the event comes from an AI agent.",
      inputSchema: EventInput.shape,
    },
    async (input) => {
      const { inserted, duplicates, ignored } = await store.insertEvents([EventInput.parse(input)]);
      return json({ inserted: inserted.length, duplicates, ignored, events: inserted });
    },
  );

  return server;
}

// Stateless Streamable HTTP: a fresh server + transport per request (no session affinity needed on Railway).
export async function handleMcpRequest(req: Request): Promise<Response> {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
