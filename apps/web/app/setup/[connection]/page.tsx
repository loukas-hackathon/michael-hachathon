import { isLive, SetupConnection } from "@michael/shared";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { StandaloneClose } from "@/components/standalone";
import { shortcutUrl } from "@/lib/one-tap";
import { SetupFromLink } from "./setup-from-link";

export const metadata = { title: "Set up · Michael", robots: { index: false } };

const TITLES: Record<SetupConnection, { title: string; body: string }> = {
  "apple-watch": {
    title: "Connect your Apple Watch",
    body: "Two taps and I fill in Health Auto Export for you. Sleep, workouts and heart rate, nothing else.",
  },
  iphone: {
    title: "Connect your iPhone apps",
    body: "Tell me when the apps you choose open, so I can show you where the time goes.",
  },
  mac: {
    title: "Connect your Mac",
    body: "Open Michael on your Mac, then You, Mac. One line installs it there.",
  },
};

// The page a QR code opens on the iPhone (#120). Public: the person may not be signed in on the
// phone. The setup token rides in the URL fragment, which never reaches a server; the client reads
// it, clears it from the address bar and swaps it for a device key on the first tap.
export default async function SetupPage({ params }: { params: Promise<{ connection: string }> }) {
  const parsed = SetupConnection.safeParse((await params).connection);
  if (!parsed.success) notFound();
  const copy = TITLES[parsed.data];
  // Not proven on production yet (#295): say so calmly, and offer nothing that could fail. The one
  // exception is a QR code made from a setup page opened with ?preview=1 (#306): its setup token
  // shows the steps, so the path can be proven on production before it is switched on.
  const live = isLive(parsed.data);
  return (
    // .screen sets the safe area padding outside Tailwind's layers, so the gap above is a margin.
    <main className="screen flex min-h-dvh flex-col">
      {/* The installed app has no back button: Close, so this page is never a dead end. */}
      <StandaloneClose />
      <Wordmark className="h-8 w-auto shrink-0 text-label" />
      <h1 className="mt-6 text-insight font-bold tracking-[-0.01em]">{copy.title}</h1>
      <SetupFromLink connection={parsed.data} live={live} body={copy.body} shortcutUrl={shortcutUrl()} />
    </main>
  );
}
