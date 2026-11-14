import type { ChatHistory, Score } from "@michael/shared";
import { connection } from "next/server";
import { CheckIn } from "@/components/chat/check-in";
import { LiveCheckIn } from "@/components/chat/live-check-in";
import { ScreenHeader } from "@/components/screen";
import { getChatHistory, getCheckIn, getScore, getVoiceEnabled } from "@/lib/api";
import { SAMPLE_QUESTIONS } from "@/lib/check-in-data";
import { Chat } from "./chat";
import { startersFrom } from "./starters";

export const metadata = { title: "Chat with Michael" };

export default async function ChatPage() {
  // Always per request: the history is the signed-in user's own.
  await connection();
  // History is a nicety: if it cannot load, the chat still opens and sending explains what is wrong.
  const voice = getVoiceEnabled();
  // The check in from the API (#187); the sample card only when the API cannot answer.
  const checkIn = getCheckIn().catch((err) => {
    console.error("check in:", err);
    return null;
  });
  let history: ChatHistory = { messages: [], actions: [] };
  try {
    history = await getChatHistory();
  } catch (err) {
    console.error("chat history:", err);
  }
  // Starters come from the real day, and only matter before the first line.
  let score: Score | null = null;
  if (history.messages.length === 0) score = await getScore().catch(() => null);
  const [elevenlabs, today] = await Promise.all([voice, checkIn]);

  return (
    <main className="screen flex min-h-dvh flex-col">
      <ScreenHeader context="Ask about your day and your goals" title="Chat" />
      {today ? <LiveCheckIn initial={today.questions} /> : <CheckIn questions={SAMPLE_QUESTIONS} sample />}
      <Chat
        initial={history.messages}
        initialActions={history.actions}
        starters={startersFrom(score)}
        elevenlabs={elevenlabs}
      />
    </main>
  );
}
