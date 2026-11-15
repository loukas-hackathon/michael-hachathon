import { getAgents, isClaude } from "@/lib/agents";
import { AskClaudeLine, AskClaudePopup } from "./ask-claude-popup";

/** True when an approved Claude reads Michael. Null when the agents cannot be read. */
async function claudeConnected(demo?: string): Promise<boolean | null> {
  try {
    const { agents } = await getAgents(demo === "sample" ? "sample" : undefined);
    return agents.some((a) => isClaude(a) && a.status === "approved");
  } catch {
    return null;
  }
}

/** The pop up, connected or not; nothing when the agents cannot be read. */
export async function AskClaude({ place, prompt, demo }: { place: string; prompt: string; demo?: string }) {
  const connected = await claudeConnected(demo);
  if (connected === null) return null;
  return <AskClaudePopup place={place} connected={connected} prompt={prompt} />;
}

/** The quiet line inside a detail page. */
export async function AskClaudeRow({ prompt, demo }: { prompt: string; demo?: string }) {
  const connected = await claudeConnected(demo);
  if (connected === null) return null;
  return <AskClaudeLine connected={connected} prompt={prompt} />;
}
