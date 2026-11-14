import type { ChatMessage } from "@michael/shared";
import { connection } from "next/server";
import { CheckIn } from "@/components/chat/check-in";
import { ScreenHeader } from "@/components/screen";
import { getChatHistory, getVoiceEnabled } from "@/lib/api";
import { SAMPLE_QUESTIONS } from "@/lib/check-in-data";
import { Chat } from "./chat";

export const metadata = { title: "Chat with Michael" };

export default async function ChatPage() {
  // Always per request: the history is the signed-in user's own.
  await connection();
  // History is a nicety: if it cannot load, the chat still opens and sending explains what is wrong.
  const voice = getVoiceEnabled();
  let history: ChatMessage[] = [];
  try {
    history = await getChatHistory();
  } catch (err) {
    console.error("chat history:", err);
  }
  const elevenlabs = await voice;

  return (
    <main className="screen flex min-h-dvh flex-col">
      <ScreenHeader context="Ask about your day and your goals" title="Chat" />
      <CheckIn questions={SAMPLE_QUESTIONS} sample />
      <Chat initial={history} elevenlabs={elevenlabs} />
    </main>
  );
}
