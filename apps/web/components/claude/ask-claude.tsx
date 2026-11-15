import { getAgents, isClaude } from "@/lib/agents";
import { isPresenter } from "@/lib/caller";
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

/**
 * The pop up, connected or not. Never for the presenter's laptop (it would rise over Today in front
 * of the judges) nor while a ritual preview is open; nothing when the agents cannot be read.
 */
export async function AskClaude({
  place,
  prompt,
  demo,
  ritual,
  line,
}: {
  place: string;
  prompt: string;
  demo?: string;
  ritual?: string;
  /** The card's first sentence from the person's data (askClaudeLine), or null for the stock one. */
  line?: (connected: boolean) => string | null;
}) {
  if (ritual || (await isPresenter().catch(() => false))) return null;
  const connected = await claudeConnected(demo);
  if (connected === null) return null;
  return (
    <AskClaudePopup
      place={place}
      connected={connected}
      prompt={prompt}
      line={line?.(connected) ?? undefined}
    />
  );
}

/** The quiet line inside a detail page. */
export async function AskClaudeRow({ prompt, demo }: { prompt: string; demo?: string }) {
  const connected = await claudeConnected(demo);
  if (connected === null) return null;
  return <AskClaudeLine connected={connected} prompt={prompt} />;
}
