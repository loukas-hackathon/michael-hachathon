"use client";

import type { DataDeleteResult } from "@michael/shared";
import { useState } from "react";
import { type DeleteOutcome, deleteEverything } from "./actions";

// Plain names for the tables in DataDeleteResult.deleted. Anything else shows as "Other records".
const LABELS: Record<string, string> = {
  events: "Timeline events",
  event_summaries: "Daily summaries",
  goals: "Goals",
  recommendations: "Recommendations",
  analysis_runs: "Analyses",
  nudges: "Nudges",
  chat_messages: "Chat messages",
  instructions: "Standing instructions",
  telegram_chats: "Telegram",
  integrations: "Connected accounts",
  push_subscriptions: "Devices with nudges on",
  personal_tokens: "Device keys",
  agent_clients: "Connected agents",
  agent_queries: "Agent query log",
  oauth_tokens: "Agent sign ins",
  oauth_grants: "Agent approvals",
  places: "Saved places",
  geocode_cache: "Looked up addresses",
  source_settings: "Source switches",
  privacy_state: "Off the record setting",
  user_profiles: "Profile",
};

function Counts({ result }: { result: DataDeleteResult }) {
  const rows = Object.entries(result.deleted)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a);
  return (
    <>
      <p className="mt-6 text-title3 font-bold">
        Done. {result.total.toLocaleString("en-GB")} records deleted.
      </p>
      {rows.length ? (
        <ul className="mt-3 overflow-hidden rounded-group bg-fill">
          {rows.map(([table, n], i) => (
            <li
              key={table}
              className="relative flex min-h-11 items-center justify-between px-4 py-2 text-body"
            >
              {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
              <span>{LABELS[table] ?? "Other records"}</span>
              <span className="tabular-nums text-label-2">{n.toLocaleString("en-GB")}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 px-4 text-footnote text-label-2">
        {result.google_revoked ? "Google no longer lets me see your calendar. " : ""}
        {result.account_deleted ? "Your sign in is gone too." : "Sign out to finish."}
      </p>
      <a
        href="/auth/signout"
        className="press mt-6 flex h-11 items-center justify-center rounded-group bg-fill text-body font-semibold"
      >
        Close
      </a>
    </>
  );
}

// Two steps: say what goes, then ask once more. Nothing is deleted until the second tap.
export function DeleteFlow() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DeleteOutcome | null>(null);

  if (outcome && "result" in outcome) return <Counts result={outcome.result} />;

  return (
    <>
      <section className="mt-6 rounded-group bg-fill px-4 py-4">
        <p className="text-body font-semibold">What goes</p>
        <p className="mt-1 text-subhead text-label-2">
          Your timeline, goals, recommendations, nudges, chats, saved places, device keys, connected agents
          and your sign in. I tell Google to forget my access to your calendar. Nothing is kept as a backup.
        </p>
      </section>

      {confirming ? (
        <section className="mt-6 rounded-group bg-fill px-4 py-4">
          <p className="text-body font-semibold">Delete everything. This can&apos;t be undone.</p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setOutcome(null);
              }}
              className="press flex h-11 flex-1 items-center justify-center rounded-group bg-bg text-body font-semibold disabled:opacity-60"
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setOutcome(await deleteEverything());
                setBusy(false);
              }}
              className="press flex h-11 flex-1 items-center justify-center rounded-group bg-danger text-body font-semibold text-on-tint disabled:opacity-60"
            >
              {busy ? "Deleting" : "Delete everything"}
            </button>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="press mt-6 flex h-11 w-full items-center justify-center rounded-group bg-fill text-body font-semibold text-danger"
        >
          Delete my data
        </button>
      )}
      {outcome && "error" in outcome ? (
        <p className="mt-2 px-4 text-footnote text-danger">{outcome.error}</p>
      ) : null}
    </>
  );
}
