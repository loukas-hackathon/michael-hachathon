import { type NextRequest, NextResponse } from "next/server";
import { isDemoVisitor, isPresenter } from "@/lib/caller";
import { decideConnect } from "@/lib/connect";
import { consentPath, signInAgainPath } from "@/lib/connect-outcome";
import { publicOrigin, publicUrl } from "@/lib/public-origin";

// The consent form posts here; the API turns the answer into a redirect back to the client
// (claude.ai) with a one time code, or with access_denied. Every other answer leads somewhere a
// person can act on: expired goes to the consent page's "start again", a dead session signs in
// again and comes back, anything else shows the consent page with one line to try again.
export async function POST(request: NextRequest) {
  // Only our own consent page may answer (no cross site form posts).
  const origin = request.headers.get("origin");
  if (origin && origin !== publicOrigin(request)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const form = await request.formData();
  const id = String(form.get("request") ?? "");
  const allow = form.get("allow") === "yes";
  // Demo visitors cannot connect agents (the API refuses too): back to the page, which says why.
  // The presenter can (lib/presenter.ts); the API checks the presenter key again.
  if (id && (await isDemoVisitor()) && !(await isPresenter()))
    return NextResponse.redirect(publicUrl(consentPath(id), request), 303);
  const decided = id ? await decideConnect(id, allow) : ({ kind: "expired" } as const);
  const target =
    decided.kind === "ok"
      ? decided.redirectTo
      : decided.kind === "signed_out"
        ? signInAgainPath(id)
        : consentPath(id, decided.kind === "failed");
  // 303 so the browser follows with a GET.
  return NextResponse.redirect(publicUrl(target, request), 303);
}
