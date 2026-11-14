"use server";

import { createPersonalToken } from "@/lib/api";

export type ConnectResult = { url: string; secret: string } | { error: string };

export async function createLink(name: string): Promise<ConnectResult> {
  try {
    const created = await createPersonalToken(name);
    return { url: created.mcp_url, secret: created.secret };
  } catch {
    return { error: "I could not create the link. Sign in with Google and try again." };
  }
}
