import type { ChatMessage } from "@michael/shared";
import { ScreenHeader } from "@/components/screen";
import { getChatHistory } from "@/lib/api";
import { Chat } from "./chat";

export const metadata = { title: "Chat with Michael" };

export default async function ChatPage() {
  // History is a nicety: if it cannot load, the chat still opens and sending explains what is wrong.
  let history: ChatMessage[] = [];
  try {
    history = await getChatHistory();
  } catch (err) {
    console.error("chat history:", err);
  }

  return (
    <main className="screen flex min-h-dvh flex-col">
      <ScreenHeader context="Ask about your day and your goals" title="Michael" />
      <Chat initial={history} />
    </main>
  );
}
