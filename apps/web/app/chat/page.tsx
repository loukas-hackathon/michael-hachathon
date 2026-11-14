import type { ChatHistory, Score } from "@michael/shared";
import { connection } from "next/server";
import { CheckIn } from "@/components/chat/check-in";
import { ScreenHeader } from "@/components/screen";
import { getChatHistory, getScore, getVoiceEnabled } from "@/lib/api";
import { SAMPLE_QUESTIONS } from "@/lib/check-in-data";
import { Chat } from "./chat";
import { startersFrom } from "./starters";

export const metadata = { title: "Chat with Michael" };

export default async function ChatPage() {
  // Always per request: the history is the signed-in user's own.
  await connection();
  // History is a nicety: if it cannot load, the chat still opens and sending explains what is wrong.
  const voice = getVoiceEnabled();
  // The score starts with the history instead of after it; it is only read for an empty chat.
  const scoreLoad = getScore().catch(() => null);
  let history: ChatHistory = { messages: [], actions: [] };
  try {
    history = await getChatHistory();
  } catch (err) {
    console.error("chat history:", err);
  }
  // Starters come from the real day, and only matter before the first line.
  let score: Score | null = null;
  if (history.messages.length === 0) score = await scoreLoad;
  const elevenlabs = await voice;

  return (
    <main className="screen flex min-h-dvh flex-col">
      <ScreenHeader context="Ask about your day and your goals" title="Chat" />
      <CheckIn questions={SAMPLE_QUESTIONS} sample />
      <Chat
        initial={history.messages}
        initialActions={history.actions}
        starters={startersFrom(score)}
        elevenlabs={elevenlabs}
      />
    </main>
  );
}
