"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { NO_MAC_COOKIE } from "./no-mac";

/** "Skip, I don't use a Mac": the Mac becomes optional everywhere on this device. */
export async function skipMac(): Promise<void> {
  (await cookies()).set(NO_MAC_COOKIE, "1", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
  });
  revalidatePath("/", "layout");
}
