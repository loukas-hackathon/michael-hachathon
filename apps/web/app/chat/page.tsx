import type { ChatHistory, ChatThread, Score } from "@michael/shared";
import { connection } from "next/server";
import { CheckIn } from "@/components/chat/check-in";
import { LiveCheckIn } from "@/components/chat/live-check-in";
import { getChatHistory, getChatThreads, getCheckIn, getScore, getVoiceEnabled } from "@/lib/api";
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
  // The latest conversation opens, as Messages does; the rest are one tap away in the list.
  const [history, threads] = await Promise.all([
    getChatHistory().catch((err): ChatHistory => {
      console.error("chat history:", err);
      return { messages: [], actions: [], thread: null };
    }),
    getChatThreads().catch((err): ChatThread[] => {
      console.error("chat threads:", err);
      return [];
    }),
  ]);
  // Starters from the real day matter before the first line; a later new chat gets the plain ones,
  // so the score is not fetched on every visit.
  const score =
    history.messages.length === 0 ? getScore().catch((): Score | null => null) : Promise.resolve(null);
  const [elevenlabs, today, day] = await Promise.all([voice, checkIn, score]);

  return (
    <main className="screen m-dash m-panes flex min-h-dvh flex-col">
      <Chat
        thread={history.thread}
        initial={history.messages}
        initialActions={history.actions}
        threads={threads}
        starters={startersFrom(day)}
        elevenlabs={elevenlabs}
        checkIn={
          today ? <LiveCheckIn initial={today.questions} /> : <CheckIn questions={SAMPLE_QUESTIONS} sample />
        }
      />
    </main>
  );
}
