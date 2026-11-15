"use server";

import {
  type SetupConnection,
  SetupConnection as SetupConnectionSchema,
  SetupTokenCreated,
  SetupTokenExchanged,
} from "@michael/shared";
import QRCode from "qrcode";
import { API_URL } from "./api";
import { authHeaders, isDemoVisitor } from "./caller";

// One tap setup (#120). Two ways to get a device key, both through a short lived setup token:
// - connectHere: on the device itself (the iPhone opening Health Auto Export, Shortcuts), the web
//   server mints a setup token and swaps it straight away, so the browser only ever holds the key
//   for the moment it takes to open the app.
// - createSetupLink: for another device. The QR code (iPhone) or the install line and .command
//   file (Mac) carry the setup token, which works once for 30 minutes. The key never sits in a URL.
// Always talks to the real API, also with USE_MOCKS.

export type KeyResult = { secret: string; apiBase: string } | { error: string };
export type LinkResult =
  | { token: string; setupUrl: string; installCommand: string | null; qrSvg: string; expiresAt: string }
  | { error: string };

const SIGN_IN = "Sign in to connect your own devices.";

async function mint(connection: SetupConnection) {
  if (await isDemoVisitor()) throw new Error(SIGN_IN);
  const res = await fetch(`${API_URL}/v1/setup-tokens`, {
    method: "POST",
    headers: { ...(await authHeaders()), "content-type": "application/json" },
    body: JSON.stringify({ connection: SetupConnectionSchema.parse(connection) }),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new Error(SIGN_IN);
  if (!res.ok) throw new Error(String(res.status));
  return SetupTokenCreated.parse(await res.json());
}

async function swap(token: string): Promise<KeyResult> {
  const res = await fetch(`${API_URL}/v1/setup-tokens/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 400) {
    return { error: "This setup link has expired or was used. Make a new one in Michael." };
  }
  if (!res.ok) return { error: "I couldn't reach Michael. Try again in a minute." };
  const body = SetupTokenExchanged.parse(await res.json());
  return { secret: body.secret, apiBase: body.api_url.replace(/\/$/, "") };
}

const message = (e: unknown) =>
  e instanceof Error && e.message === SIGN_IN ? SIGN_IN : "I couldn't set this up. Sign in again and retry.";

/** A device key for the device this page is open on. */
export async function connectHere(connection: SetupConnection): Promise<KeyResult> {
  try {
    return await swap((await mint(connection)).token);
  } catch (e) {
    return { error: message(e) };
  }
}

/** A setup link for another device: a QR code of the setup page and, for the Mac, the install line. */
export async function createSetupLink(connection: SetupConnection): Promise<LinkResult> {
  try {
    const created = await mint(connection);
    const qrSvg = await QRCode.toString(created.setup_url, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
    return {
      token: created.token,
      setupUrl: created.setup_url,
      installCommand: created.install_command,
      qrSvg,
      expiresAt: created.expires_at,
    };
  } catch (e) {
    return { error: message(e) };
  }
}

/** The setup page on the other device: swaps the token from the QR code for a device key. */
export async function exchangeSetupToken(token: string): Promise<KeyResult> {
  if (!/^ms_[A-Za-z0-9_-]{20,200}$/.test(token)) {
    return { error: "This setup link is not complete. Scan the code again." };
  }
  try {
    return await swap(token);
  } catch {
    return { error: "I couldn't reach Michael. Try again in a minute." };
  }
}
