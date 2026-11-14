import Link from "next/link";
import { isDemo } from "@/lib/api";
import { ConnectCard } from "./connect-card";

export const metadata = { title: "Connect · Michael" };

export default async function ConnectPage() {
  const demo = await isDemo();
  return (
    <main className="screen">
      <header className="flex min-h-11 items-center justify-end pt-2">
        <Link
          href="/you"
          className="press -mr-2 flex h-11 items-center px-2 text-body font-semibold text-tint-text"
        >
          Done
        </Link>
      </header>
      <h1 className="text-large-title font-bold tracking-[0.01em]">Connect</h1>
      <p className="mt-1 text-subhead text-label-2">
        Your data, wherever you need me. Each link works only for you.
      </p>

      {demo ? (
        <p className="mt-6 rounded-group bg-fill px-4 py-3 text-subhead">
          You are browsing the demo week. Sign in with Google to connect your own Claude and devices.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          <ConnectCard
            title="Claude"
            body="Ask Claude about your day and goals, and tell it what happened. Works on the web, the phone app and in voice."
            tokenName="Claude"
            show="url"
            steps={[
              "In Claude, open Settings, then Connectors.",
              "Tap Add custom connector, name it Michael, paste the link.",
              "In a chat, ask: What are my goals and how did today go?",
            ]}
          />
          <ConnectCard
            title="Your Mac"
            body="App time, screen time from your iPhone, Chrome and Claude Code, sent from your Mac."
            tokenName="Mac collector"
            show="secret"
            steps={["Paste it into the Michael collector when it asks for your key."]}
          />
        </div>
      )}
    </main>
  );
}
