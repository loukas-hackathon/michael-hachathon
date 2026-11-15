import { SkipMacButton } from "@/components/setup/skip-mac-button";
import type { ConnectionsView } from "@/lib/connections-status";
import { ProgressBar } from "../progress-bar";
import { ConnectionRow } from "./connection-row";

// The first part of You: everything the user can connect, what each one is doing right now, and
// the one next step. The summary line counts only what is really connected.
// The demo week replays a recorded week from these four. A demo visitor sees them as what they
// are, sample data, instead of "Not connected" and "Coming soon" under numbers that quote them.
const DEMO_SAMPLE: ReadonlySet<string> = new Set(["google-calendar", "apple-watch", "mac", "iphone"]);

export function ConnectionsList({
  view,
  flash,
  demo = false,
}: {
  view: ConnectionsView;
  flash: { ok: boolean; text: string } | null;
  /** A demo visitor (the "This is the demo week" banner on You). A signed in user never sets it. */
  demo?: boolean;
}) {
  // Coming soon (#295) and optional rows are not counted: "1 of 4 connected" means four to connect.
  const total = view.total;
  const mac = view.rows.find((r) => r.id === "mac");
  // No Mac yet: say plainly that the rest works without one, and let the person say so once.
  const noMacYet = !demo && (mac?.state === "none" || mac?.state === "optional");
  const sample = (id: string) => demo && DEMO_SAMPLE.has(id);
  const summary = demo
    ? "The demo week runs on sample data from calendar, Mac, iPhone and watch."
    : view.connected === 0
      ? "Nothing connected yet."
      : view.connected === total
        ? `All ${total} connected.`
        : `${view.connected} of ${total} connected.`;
  // Every connection is a row with Connect or Manage (Loukas, Sun 15 Nov). One switched back to
  // Coming soon in CONNECTOR_STATUS keeps its row, quieter and with nothing to tap.
  const rows = view.rows;

  return (
    <section id="connections" className="mt-6 scroll-mt-4">
      <h2 className="text-title3 font-bold">Connections</h2>
      <p className="mt-1 mb-3 text-subhead text-label-2">
        {summary}
        {view.next && !demo ? (
          <>
            {" "}
            Next: <b className="font-semibold text-label">{view.next.name}</b>.
          </>
        ) : null}
      </p>
      {!demo && view.connected > 0 && view.connected < total ? (
        <ProgressBar
          value={view.connected / total}
          size="sm"
          label="Connections"
          valueText={`${view.connected} of ${total} connected`}
          className="mb-4"
        />
      ) : null}
      {flash ? (
        <p
          role="status"
          className={`mb-3 rounded-group bg-fill px-4 py-3 text-subhead ${flash.ok ? "" : "text-danger"}`}
        >
          {flash.text}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-group bg-fill">
        {rows.map((row, i) => (
          <div key={row.id} className="relative">
            {i > 0 ? <span className="absolute inset-x-0 top-0 ml-[52px] h-[0.5px] bg-separator" /> : null}
            <ConnectionRow row={row} sample={sample(row.id)} />
          </div>
        ))}
      </div>
      {noMacYet ? (
        <div className="mt-2 px-4">
          <p className="text-footnote text-label-2">No Mac? Everything else works without one.</p>
          {mac?.state === "none" ? <SkipMacButton /> : null}
        </div>
      ) : null}
    </section>
  );
}
