import Link from "next/link";
import { getPrivacy } from "@/lib/api";
import { OffTheRecordSwitch } from "./off-the-record-switch";
import { SourceSwitches } from "./source-switches";

const PROMISES = [
  [
    "One client.",
    "I work for you only. Not for an employer, an insurer, an advertiser, or the agent asking about you.",
  ],
  ["Open book.", "Everything I know about you is on your timeline. You can see it and delete it."],
  ["Coaches you, forgets them.", "I keep the lesson and your own commitments, never other people's words."],
] as const;

export default async function YouPage() {
  // The source switches need the API; if it is down, the rest of the page still works.
  const privacy = await getPrivacy().catch(() => null);
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

      <section className="mt-6 overflow-hidden rounded-group bg-fill">
        <OffTheRecordSwitch />
      </section>
      <p className="mt-2 px-4 text-footnote text-label-2">One tap stops all collection, on every source.</p>

      <h2 className="mt-8 mb-2 text-title3 font-bold">Sources</h2>
      {privacy ? (
        <>
          <SourceSwitches initial={privacy.sources} />
          <p className="mt-2 px-4 text-footnote text-label-2">
            Each source is off until you connect it. Switch one off and I stop reading it.
          </p>
        </>
      ) : (
        <p className="px-4 text-footnote text-label-2">I could not load your sources. Pull to refresh.</p>
      )}

      <h2 className="mt-8 mb-2 text-title3 font-bold">Three promises</h2>
      <ul className="overflow-hidden rounded-group bg-fill">
        {PROMISES.map(([title, body], i) => (
          <li key={title} className="relative px-4 py-3">
            {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
            <p className="text-body font-semibold">{title}</p>
            <p className="text-subhead text-label-2">{body}</p>
          </li>
        ))}
      </ul>

      <Link
        href="/you/devices"
        className="press mt-8 flex h-12 items-center justify-between rounded-group bg-fill px-4 text-body font-semibold"
      >
        Devices
        <span className="text-label-2">›</span>
      </Link>

      <a
        href="/auth/signout"
        className="press mt-8 flex h-11 items-center justify-center rounded-group bg-fill text-body font-semibold text-danger"
      >
        Sign out
      </a>
    </main>
  );
}
