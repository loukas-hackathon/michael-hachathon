import Link from "next/link";
import { DeviceCard } from "./device-card";

export const metadata = { title: "Devices · Michael" };

// Devices that send data to Michael. Each gets its own key, so data lands in your account only.
// Claude connects on its own (claude.ai Connectors, sign in), no key needed.
export default function DevicesPage() {
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
      <h1 className="text-large-title font-bold tracking-[0.01em]">Devices</h1>
      <p className="mt-1 text-subhead text-label-2">
        Each device gets its own key. Your data goes to you only.
      </p>
      <div className="mt-6 flex flex-col gap-4">
        <DeviceCard
          title="Your Mac"
          body="App time, iPhone screen time, Chrome and Claude Code, sent from your Mac."
          keyName="Mac collector"
          copyAs={{ kind: "key" }}
          steps={["Paste it into the Michael collector when it asks for your key."]}
        />
        <DeviceCard
          title="Apple Watch"
          body="Sleep, workouts and heart rate through the Health Auto Export app."
          keyName="Health Auto Export"
          copyAs={{ kind: "webhook", path: "health-auto-export" }}
          steps={[
            "Open Health Auto Export, then Automations, then New, then REST API.",
            "Paste this as the URL. Format JSON, every 5 minutes.",
            "Pick sleep, workouts, heart rate, HRV and steps. Save.",
          ]}
        />
      </div>
    </main>
  );
}
