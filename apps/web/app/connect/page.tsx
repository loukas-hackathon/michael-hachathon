import { cookies } from "next/headers";
import { Wordmark } from "@/components/brand";
import { SCOPE_LABEL } from "@/lib/agents";
import { getConnectRequest } from "@/lib/connect";
import { authEnabled, DEMO_COOKIE, supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "Connect · Michael" };

// The one tap in "paste one URL into claude.ai, tap Allow". The API's OAuth authorise step sends
// the browser here; the proxy has already made sure the person is signed in.
export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const { request: id } = await searchParams;
  const request = id ? await getConnectRequest(id) : null;

  if (!request) {
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
  if ((await cookies()).get(DEMO_COOKIE)?.value === "1") return "the demo week";
  const { data } = await (await supabaseServer()).auth.getUser();
  return data.user?.email ?? null;
}
