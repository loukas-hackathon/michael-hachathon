import { type NextRequest, NextResponse } from "next/server";
import { isDemoVisitor } from "@/lib/caller";
import { decideConnect } from "@/lib/connect";

// The consent form posts here; the API turns the answer into a redirect back to the client
// (claude.ai) with a one time code, or with access_denied.
export async function POST(request: NextRequest) {
  // Only our own consent page may answer (no cross site form posts).
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const form = await request.formData();
  const id = String(form.get("request") ?? "");
  const allow = form.get("allow") === "yes";
  // Demo visitors cannot connect agents (the API refuses too): back to the page, which says why.
  const target = id && !(await isDemoVisitor()) ? await decideConnect(id, allow) : null;
  // 303 so the browser follows with a GET.
  return NextResponse.redirect(
    target ?? new URL(`/connect?request=${encodeURIComponent(id)}`, request.url),
    303,
  );
}
