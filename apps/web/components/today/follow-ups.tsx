"use client";

import type { Draft } from "@michael/shared";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { markDraft } from "@/lib/draft-actions";
import { Fold } from "./fold";

// Today's "Follow ups" (#40): one quiet row under "More from Michael" holding the drafts Michael
// wrote after conversations and meetings with other people. The user copies one and sends it
// themselves; Michael never sends anything. Feedback stays in place (michael-feedback): Copy turns
// into "Copied", Done and Not now hide the draft at once and bring it back with a line if they fail.

const tinted =
  "press min-h-9 min-w-[84px] rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text disabled:opacity-60";
const plain = "press min-h-9 rounded-full px-3 text-subhead font-semibold text-tint-text disabled:opacity-60";

type Local = { copied?: boolean; hidden?: boolean; busy?: boolean; error?: string };

const fullText = (d: Draft) => (d.subject ? `Subject: ${d.subject}\n\n${d.body}` : d.body);
const kind = (d: Draft) => (d.channel === "email" ? "Email" : "Message");

function DraftItem({ draft, local, set }: { draft: Draft; local: Local; set: (l: Local) => void }) {
  const router = useRouter();

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullText(draft));
      set({ ...local, copied: true, error: undefined });
    } catch {
      set({
        ...local,
        copied: false,
        error: "I couldn't reach the clipboard. Select the text and copy it.",
      });
    }
  }

  async function mark(status: "done" | "dismissed") {
    if (local.busy) return;
    const before = local;
    set({ ...local, busy: true, hidden: true, error: undefined });
    let ok = false;
    let line = "I couldn't save that. Nothing changed.";
    try {
      const r = await markDraft(draft.id, status);
      ok = r.ok;
      if (r.error) line = r.error;
    } catch {
      ok = false;
    } finally {
      if (ok) {
        set({ ...before, busy: false, hidden: true });
        startTransition(() => router.refresh());
      } else {
        set({ ...before, busy: false, hidden: false, error: line });
      }
    }
  }

  return (
    <div className="flex flex-col gap-1.5" aria-busy={local.busy}>
      <p className="text-footnote font-semibold text-label-2">
        {kind(draft)} after {draft.title}
      </p>
      {draft.subject ? <p className="text-subhead font-semibold">{draft.subject}</p> : null}
      <p className="select-text whitespace-pre-line text-subhead">{draft.body}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button type="button" className={tinted} onClick={copy} aria-live="polite">
          {local.copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className={plain} disabled={local.busy} onClick={() => mark("done")}>
          Done
        </button>
        <button type="button" className={plain} disabled={local.busy} onClick={() => mark("dismissed")}>
          Not now
        </button>
      </div>
      {local.error ? (
        <p role="alert" className="text-subhead text-danger">
          {local.error}
        </p>
      ) : null}
    </div>
  );
}

export function FollowUpRow({ drafts }: { drafts: Draft[] }) {
  const [local, setLocal] = useState<Record<string, Local>>({});
  const visible = drafts.filter((d) => !local[d.id]?.hidden);
  const first = drafts[0];
  if (!first) return null;
  const preview =
    drafts.length === 1
      ? `${kind(first)} after ${first.title}, ready to send.`
      : `${drafts.length} drafts ready to send, starting with ${first.title}.`;

  return (
    <Fold title="Follow ups" label="Follow ups" preview={preview}>
      <p className="text-footnote text-label-2">Drafted for you to send. I never send anything.</p>
      {visible.length === 0 ? (
        <p role="status" className="text-subhead text-label-2">
          All cleared.
        </p>
      ) : (
        visible.map((d) => (
          <DraftItem
            key={d.id}
            draft={d}
            local={local[d.id] ?? {}}
            set={(l) => setLocal((s) => ({ ...s, [d.id]: l }))}
          />
        ))
      )}
    </Fold>
  );
}
