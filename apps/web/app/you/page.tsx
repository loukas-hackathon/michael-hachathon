import Link from "next/link";
import { MeetingsRow } from "@/components/meetings";
import { ConnectionsList } from "@/components/you/connections-list";
import { StandingInstructions } from "@/components/you/instructions";
import { signedInAs } from "@/lib/account";
import { getInstructions, getProfile } from "@/lib/api";
import { isPresenter } from "@/lib/caller";
import { getConnections } from "@/lib/connections-status";
import { DeleteDataRow } from "./delete-data-row";
import { OffTheRecordSwitch } from "./off-the-record-switch";

const separator = "absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator";

// You: one hub, in four parts. Connections (what is plugged in and sending), Privacy, Michael
// (how he coaches), Account. Each connection's setup and its privacy switches live on its own page.
export default async function YouPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; integration_error?: string }>;
}) {
  const params = await searchParams;
  // Every call fails on its own: if the API is down, the rest of the page still works.
  const [connections, instructions, profile, account, presenter] = await Promise.all([
    getConnections(),
    getInstructions().catch(() => ({ available: false as const })),
    getProfile().catch(() => null),
    signedInAs(),
    isPresenter(),
  ]);
  const flash =
    params.connected === "google_calendar"
      ? { ok: true, text: "Google Calendar connected. Your plans are on the timeline." }
      : params.integration_error === "google_calendar"
        ? { ok: false, text: "Google Calendar didn't connect. Try again." }
        : null;

  return (
    <main className="screen">
      <header className="flex min-h-11 items-center justify-end pt-2">
        <Link
          href="/"
          className="press -mr-2 flex h-11 items-center px-2 text-body font-semibold text-tint-text"
        >
          Done
        </Link>
      </header>
      <h1 className="text-large-title font-bold tracking-[0.01em]">You</h1>
      {account === "The demo week" && !presenter ? (
        // The API refuses account changes from demo visitors; say so before a switch bounces back.
        // The presenter may switch Off the record (#343), so the projector shows no sign in card.
        <Link href="/login" className="press mt-4 block rounded-group bg-fill px-4 py-3">
          <span className="block text-body font-semibold">This is the demo week.</span>
          <span className="block text-subhead text-label-2">Sign in with Google to make it yours.</span>
        </Link>
      ) : null}

      {/* The Mi button is on every tab, so the two things people look for in it come first. */}
      <div className="mt-4 overflow-hidden rounded-group bg-fill">
        {/* Meetings mode (#422): the quick toggle sits first, one tap before a meeting starts. */}
        <MeetingsRow first />
        <Link
          href="/chat?talk=1"
          className="press relative flex min-h-14 items-center justify-between gap-3 px-4 py-2"
        >
          <span className={separator} />
          <span className="flex flex-col">
            <span className="text-body">Talk to Michael</span>
            <span className="text-footnote text-label-2">Out loud, hands free</span>
          </span>
          <span aria-hidden="true" className="text-label-2">
            ›
          </span>
        </Link>
        <Link
          href="/agents"
          className="press relative flex min-h-14 items-center justify-between gap-3 px-4 py-2"
        >
          <span className={separator} />
          <span className="flex flex-col">
            <span className="text-body">Agents</span>
            <span className="text-footnote text-label-2">Who asks about you, and what they may see</span>
          </span>
          <span aria-hidden="true" className="text-label-2">
            ›
          </span>
        </Link>
      </div>

      <ConnectionsList view={connections} flash={flash} demo={account === "The demo week"} />

      <section id="privacy" className="mt-8 scroll-mt-4">
        <h2 className="mb-2 text-title3 font-bold">Privacy</h2>
        <div className="overflow-hidden rounded-group bg-fill">
          <OffTheRecordSwitch />
        </div>
        <Link
          href="/you/knowledge"
          className="press mt-4 flex min-h-14 items-center justify-between gap-3 rounded-group bg-fill px-4 py-2"
        >
          <span className="flex flex-col">
            <span className="text-body">What I know about you</span>
            <span className="text-footnote text-label-2">In plain words. Forget any of it</span>
          </span>
          <span aria-hidden="true" className="text-label-2">
            ›
          </span>
        </Link>
        <DeleteDataRow />
      </section>

      <StandingInstructions
        available={instructions.available}
        items={instructions.available ? instructions.items : []}
        quiet={profile?.quiet_hours ?? null}
      />

      <section id="account" className="mt-8 scroll-mt-4">
        <h2 className="mb-2 text-title3 font-bold">Account</h2>
        {/* Redo setup lives here rather than under a heading of its own: one row needs no section. */}
        <div className="overflow-hidden rounded-group bg-fill">
          <Link
            href="/onboarding"
            className="press relative flex min-h-12 items-center justify-between gap-3 px-4 py-2"
          >
            <span className="flex flex-col">
              <span className="text-body">Redo setup</span>
              <span className="text-footnote text-label-2">Goals and connections</span>
            </span>
            <span aria-hidden="true" className="text-label-2">
              ›
            </span>
          </Link>
          <p className="relative flex min-h-12 items-center justify-between gap-3 px-4 py-2">
            <span className={separator} />
            <span className="text-body">Signed in as</span>
            <span className="min-w-0 truncate text-body text-label-2">{account}</span>
          </p>
          <a
            href="/auth/signout"
            className="press relative flex h-12 items-center px-4 text-body font-semibold text-danger"
          >
            <span className={separator} />
            Sign out
          </a>
        </div>
      </section>
    </main>
  );
}
