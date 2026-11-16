import { type NextRequest, NextResponse } from "next/server";
import { telegramConnectUrl } from "@/lib/integrations";
import { publicUrl } from "@/lib/public-origin";

// "Connect Telegram": one tap. Ask the API for a t.me link with a one-time start token for this
// user and send the browser there; Telegram opens the bot, the user taps Start, and it is bound.
export async function GET(request: NextRequest) {
  try {
    return NextResponse.redirect(await telegramConnectUrl());
  } catch {
    return NextResponse.redirect(publicUrl("/you?integration_error=telegram", request));
  }
}
