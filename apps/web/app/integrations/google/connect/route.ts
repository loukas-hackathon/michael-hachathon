import { type NextRequest, NextResponse } from "next/server";
import { googleConnectUrl } from "@/lib/integrations";

// "Connect Google Calendar": one tap. Ask the API for Google's consent screen (bound to this user
// by a signed state) and send the browser there. Google returns to the API, which returns to /you.
export async function GET(request: NextRequest) {
  try {
    return NextResponse.redirect(await googleConnectUrl());
  } catch {
    return NextResponse.redirect(new URL("/you?integration_error=google_calendar", request.url));
  }
}
