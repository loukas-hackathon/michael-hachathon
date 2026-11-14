// Talking to Michael's API. Used by the service worker (sending the queue) and by the settings
// page (the test event). The extension may only call origins it holds a host permission for:
// localhost is granted at install, anything else is asked for when the address is saved.

import { SEND_TIMEOUT_MS } from "./config.js";

/** Parses what the user typed as the API address. Returns { ok, url, origin } or { ok: false }. */
export function parseApiUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false };
  // Without a scheme: http for this machine, https for everything else.
  const scheme = /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(text) ? "http" : "https";
  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${scheme}://${text}`);
  } catch {
    return { ok: false };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false };
  if (!parsed.hostname) return { ok: false };
  const path = parsed.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${parsed.origin}${path}`, origin: parsed.origin };
}

/**
 * The match pattern that covers an API address, for chrome.permissions. Match patterns ignore the
 * path and are written without a port here, which covers every port on that host.
 */
export function originPattern(apiUrl) {
  const { protocol, hostname } = new URL(apiUrl);
  return `${protocol}//${hostname}/*`;
}

/** localhost and 127.0.0.1 are in the manifest's host_permissions and need no question. */
export function isGrantedAtInstall(apiUrl) {
  const { protocol, hostname } = new URL(apiUrl);
  return protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1");
}

export async function hasPermissionFor(apiUrl) {
  if (isGrantedAtInstall(apiUrl)) return true;
  return chrome.permissions.contains({ origins: [originPattern(apiUrl)] });
}

/**
 * POST /v1/events/batch. Never throws. Result:
 *   { ok: true, inserted, duplicates, ignored }
 *   { ok: false, kind: "no_key" | "no_permission" | "network" | "http" | "not_michael", status? }
 */
export async function postEvents({ apiUrl, apiKey }, events) {
  if (!apiKey) return { ok: false, kind: "no_key" };
  let allowed = false;
  try {
    allowed = await hasPermissionFor(apiUrl);
  } catch {
    allowed = false;
  }
  if (!allowed) return { ok: false, kind: "no_permission" };

  let response;
  try {
    response = await fetch(`${apiUrl}/v1/events/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ events }),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, kind: "network" };
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) return { ok: false, kind: "http", status: response.status };
  // A 200 from something that is not Michael's API (a login page, another service) must not
  // count as delivered, or the queue would be emptied into nowhere.
  if (typeof body?.inserted !== "number") return { ok: false, kind: "not_michael", status: response.status };
  return {
    ok: true,
    inserted: body.inserted,
    duplicates: Number(body.duplicates ?? 0),
    ignored: Number(body.ignored ?? 0),
  };
}

/** A failed send that can never succeed by trying again: the API read the events and refused them. */
export const isRejected = (result) =>
  !result.ok && result.kind === "http" && [400, 413, 422].includes(result.status);

/** What went wrong, in plain words. */
export function explainFailure(result, apiUrl) {
  switch (result.kind) {
    case "no_key":
      return "There is no API key yet. Add it above and save.";
    case "no_permission":
      return `Chrome has not been allowed to reach ${apiUrl}. Save the address again and choose Allow.`;
    case "network":
      return `Could not reach ${apiUrl}. Check the address and that the API is running.`;
    case "not_michael":
      return `${apiUrl} answered, but not like Michael's API. Check the address.`;
    case "http":
      if (result.status === 401 || result.status === 403)
        return "The API refused the key. Check the API key.";
      if (result.status === 404)
        return `${apiUrl} answered, but not like Michael's API (404). Check the address.`;
      if (result.status >= 500)
        return `The API has a problem of its own (${result.status}). Try again in a minute.`;
      return `The API refused the events (${result.status}).`;
    default:
      return "Sending failed for a reason I could not identify.";
  }
}

/**
 * The event behind "Send a test event". A note, not a web visit, so a test never adds time to a
 * site in the timeline. Each click sends a new one.
 */
export function testEvent(now = Date.now()) {
  return {
    source: "chrome",
    type: "note",
    start_at: new Date(now).toISOString(),
    end_at: null,
    title: "Test event from the Michael browser extension",
    data: { origin: "extension", test: true },
    external_id: `ext:test:${crypto.randomUUID()}`,
  };
}
