import "server-only";
import { Knowledge } from "@michael/shared";
import { get } from "./api";
import { devLatency } from "./dev-latency";

// GET /v1/me/knowledge (#379): what Michael knows about the signed-in user. Always the API, also
// with USE_MOCKS: this page must never show something made up. Null when it cannot be read.
export async function getKnowledge(): Promise<Knowledge | null> {
  await devLatency();
  try {
    return Knowledge.parse(await get<unknown>("/v1/me/knowledge"));
  } catch {
    return null;
  }
}
