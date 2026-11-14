"use server";

import { type AgentClient, AgentClientUpdate } from "@michael/shared";
import { patchAgent } from "./agents";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Server function behind the Agents screen (approve, revoke, scopes). The browser calls it; only
// the server talks to the API with the user's token. Inputs come from the browser: parse first.
export async function saveAgent(id: string, patch: AgentClientUpdate): Promise<AgentClient | null> {
  if (!UUID.test(id)) throw new Error("Unknown agent");
  return patchAgent(id, AgentClientUpdate.parse(patch));
}
