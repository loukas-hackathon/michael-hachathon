import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { SCOPE_LABEL } from "@/lib/agents";
import { isDemoVisitor } from "@/lib/caller";
import { getConnectRequest } from "@/lib/connect";
import { signInAgainPath } from "@/lib/connect-outcome";
import { authEnabled, supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "Connect · Michael" };

// The one tap in "paste one URL into claude.ai, tap Allow". The API's OAuth authorise step sends
// the browser here; the proxy has already made sure the person is signed in.
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string; error?: string }>;
}) {
  const { request: id, error } = await searchParams;
  const read = id ? await getConnectRequest(id) : ({ kind: "expired" } as const);
  // The session outlived its account or token (the proxy only checks it locally): sign in again,
  // then come back to this same request.
  if (read.kind === "signed_out" && id) redirect(signInAgainPath(id));

  if (read.kind === "failed") {
    return (
      <main className="screen flex min-h-dvh flex-col justify-center pb-24">
        <Wordmark className="h-8 w-auto text-label" />
        <h1 className="mt-6 text-insight font-bold">I couldn't load this request.</h1>
        <p className="mt-2 text-body text-label-2">
          Reload the page. If it still fails, connect again from Claude.
        </p>
      </main>
    );
  }

  if (read.kind !== "ok") {
    return (
      <main className="screen flex min-h-dvh flex-col justify-center pb-24">
        <Wordmark className="h-8 w-auto text-label" />
        <h1 className="mt-6 text-insight font-bold">This link has expired.</h1>
        <p className="mt-2 text-body text-label-2">
          Go back to Claude and connect Michael again. It takes one tap.
        </p>
      </main>
    );
  }

  const request = read.request;
  const who = await signedInAs();
  const name = request.client_name;

  return (
    <main className="screen flex min-h-dvh flex-col justify-center pb-24">
      <Wordmark className="h-8 w-auto text-label" />
      <h1 className="mt-6 text-insight font-bold tracking-[-0.01em]">
        Allow {name} to read and change your day?
      </h1>
      <p className="mt-2 text-body text-label-2">
        {name} will see what you allow below and can add to your day. I never delete, and every change can be
        undone. You can switch it off any time in Agents.
      </p>

      <ul className="mt-5 flex flex-wrap gap-1.5">
        {request.scopes.map((s) => (
          <li key={s} className="rounded-full bg-fill px-2.5 py-[3px] text-footnote font-semibold">
            {SCOPE_LABEL[s]}
          </li>
        ))}
      </ul>

      {error === "failed" ? (
        <p role="alert" className="mt-5 text-footnote text-danger">
          That didn't go through. Tap Allow again.
        </p>
      ) : null}

      <form method="post" action="/connect/decide" className="mt-8 flex flex-col gap-3">
        <input type="hidden" name="request" value={request.id} />
        <button
          type="submit"
          name="allow"
          value="yes"
          className="press flex h-12 items-center justify-center rounded-group bg-tint text-body font-semibold text-on-tint"
        >
          Allow
        </button>
        <button
          type="submit"
          name="allow"
          value="no"
          className="press flex h-12 items-center justify-center rounded-group bg-fill text-body font-semibold text-tint-text"
        >
          Not now
        </button>
      </form>

      <p className="mt-6 text-footnote text-label-2">
        {who ? `Signed in as ${who}. ` : ""}You go back to{" "}
        <b className="font-semibold text-label">{request.redirect_host}</b> afterwards.
      </p>
    </main>
  );
}

async function signedInAs(): Promise<string | null> {
  if (!authEnabled) return "the demo account";
  // A session wins over the demo cookie, as in lib/caller.ts.
  const { data } = await (await supabaseServer()).auth.getClaims();
  if (data?.claims?.sub) return data.claims.email ?? null;
  return (await isDemoVisitor()) ? "the demo week" : null;
}
