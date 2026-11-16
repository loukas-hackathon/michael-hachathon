import { ReturnPath } from "@michael/shared";
import { type NextRequest, NextResponse } from "next/server";
import { googleConnectUrl } from "@/lib/integrations";
import { publicUrl } from "@/lib/public-origin";

// "Connect Google Calendar": one tap. Ask the API for Google's consent screen (bound to this user
// by a signed state) and send the browser there. Google returns to the API, which returns to /you,
// or to `?return_to=` when that is a path on this site (onboarding uses it to come back).
export async function GET(request: NextRequest) {
  const asked = ReturnPath.safeParse(request.nextUrl.searchParams.get("return_to") ?? undefined);
  const returnTo = asked.success ? asked.data : undefined;
  try {
    return NextResponse.redirect(await googleConnectUrl(returnTo));
  } catch {
    const back = publicUrl(returnTo ?? "/you", request);
    back.searchParams.set("integration_error", "google_calendar");
    return NextResponse.redirect(back);
  }
}
