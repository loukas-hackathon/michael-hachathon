"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { DISMISS_COOKIE } from "./first-run";

/** Hide the Get started card on this device. Today offers it once three steps are done. */
export async function dismissGetStarted(): Promise<void> {
  (await cookies()).set(DISMISS_COOKIE, "1", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
  });
  revalidatePath("/");
}
