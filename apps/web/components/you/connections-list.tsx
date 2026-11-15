import type { ConnectionsView } from "@/lib/connections-status";
import { ConnectionRow } from "./connection-row";

// The first part of You: everything the user can connect, what each one is doing right now, and
// the one next step. The summary line counts only what is really connected.
export function ConnectionsList({
  view,
  flash,
}: {
  view: ConnectionsView;
  flash: { ok: boolean; text: string } | null;
}) {
  // Coming soon rows (#295) are not counted: "1 of 4 connected" means four the user can connect.
  const total = view.live;
  const summary =
    view.connected === 0
      ? "Nothing connected yet."
      : view.connected === total
        ? `All ${total} connected.`
        : `${view.connected} of ${total} connected.`;

  return (
    <section id="connections" className="mt-6 scroll-mt-4">
      <h2 className="text-title3 font-bold">Connections</h2>
      <p className="mt-1 mb-3 text-subhead text-label-2">
        {summary}
        {view.next ? (
          <>
            {" "}
            Next: <b className="font-semibold text-label">{view.next.name}</b>.
          </>
        ) : null}
      </p>
      {flash ? (
        <p
          role="status"
          className={`mb-3 rounded-group bg-fill px-4 py-3 text-subhead ${flash.ok ? "" : "text-danger"}`}
        >
          {flash.text}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-group bg-fill">
        {[...view.rows.filter((r) => r.live), ...view.rows.filter((r) => !r.live)].map((row, i) => (
          <div key={row.id} className="relative">
            {i > 0 ? <span className="absolute inset-x-0 top-0 ml-[52px] h-[0.5px] bg-separator" /> : null}
            <ConnectionRow row={row} />
          </div>
        ))}
      </div>
    </section>
  );
}
