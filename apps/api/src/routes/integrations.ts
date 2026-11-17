import {
  type CalendarSyncResult,
  IntegrationProvider,
  type IntegrationsResponse,
  OAuthConnectRequest,
  type OAuthConnectResponse,
} from "@michael/shared";
import { Hono } from "hono";
import { z } from "zod";
import { currentUserId, runAsUser } from "../context";
import { webUrl } from "../env";
import { PAST_DAYS } from "../goals/suggest";
import { currentSuggestions } from "../goals/suggestions";
import { HttpError, parse } from "../http";
import { syncGoogleCalendar } from "../integrations/calendar-sync";
import { authUrl, emailFromIdToken, exchangeCode, revokeToken } from "../integrations/google";
import { signState, verifyState } from "../integrations/state";
import { emptyIntegration, publicIntegration, store } from "../store";

function onlyGoogle(provider: IntegrationProvider) {
  if (provider !== "google_calendar")
    throw new HttpError("not_implemented", `${provider} is not wired up yet`);
}

const SyncQuery = z.object({ past_days: z.coerce.number().int().min(1).max(PAST_DAYS).optional() });

// Authed routes, mounted under /v1 behind requireUser.
export const integrations = new Hono()
  .get("/integrations", async (c) => {
    const stored = await store.listIntegrations();
    const body: IntegrationsResponse = {
      integrations: IntegrationProvider.options.map((p) =>
        publicIntegration(stored.find((r) => r.provider === p) ?? emptyIntegration(p)),
      ),
    };
    return c.json(body);
  })
  // The web app calls this with the user's token, then sends the browser to `url`. The signed
  // `state` carries the user id, because Google's redirect back to us arrives without auth.
  .post("/integrations/:provider/connect", async (c) => {
    const provider = parse(IntegrationProvider, c.req.param("provider"));
    onlyGoogle(provider);
    // The body is optional: `{ return_to }` sends the user back somewhere other than /you.
    const raw = await c.req.text();
    let input: unknown = {};
    try {
      input = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      throw new HttpError("bad_request", "Body must be valid JSON");
    }
    const { return_to } = parse(OAuthConnectRequest, input);
    const body: OAuthConnectResponse = {
      url: authUrl(signState(currentUserId(), provider, Date.now(), return_to)),
    };
    return c.json(body);
  })
  .post("/integrations/:provider/sync", async (c) => {
    const provider = parse(IntegrationProvider, c.req.param("provider"));
    onlyGoogle(provider);
    // `?past_days=28` reads further back: onboarding asks for four weeks on its first screen.
    const { past_days } = parse(SyncQuery, c.req.query());
    const body: CalendarSyncResult = await syncGoogleCalendar(Date.now(), past_days);
    return c.json(body);
  })
  // Disconnect: revoke at Google and forget the tokens. Events already on the timeline stay.
  .delete("/integrations/:provider", async (c) => {
    const provider = parse(IntegrationProvider, c.req.param("provider"));
    onlyGoogle(provider);
    const rec = await store.getIntegration(provider);
    const token = rec?.refresh_token ?? rec?.access_token;
    if (token) await revokeToken(token);
    const saved = await store.saveIntegration(provider, {
      status: "disconnected",
      access_token: null,
      refresh_token: null,
      expires_at: null,
      account: null,
      error: null,
    });
    return c.json(publicIntegration(saved));
  });

const CallbackQuery = z.object({
  state: z.string().min(1).max(2048),
  code: z.string().min(1).max(4096).optional(),
  error: z.string().max(200).optional(),
});

// Back to the web app: /you, or the signed return path (a path on the web app, never another site).
const backToWeb = (params: Record<string, string>, returnTo = "/you") => {
  const u = new URL(returnTo, `${webUrl()}/`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
};

const JUST_NOW_MS = 5 * 60_000;
async function connectedJustNow(provider: IntegrationProvider): Promise<boolean> {
  const rec = await store.getIntegration(provider).catch(() => null);
  const at = rec?.connected_at ? Date.parse(rec.connected_at) : Number.NaN;
  return rec?.status === "connected" && Date.now() - at < JUST_NOW_MS;
}

// Browser redirect from Google, mounted at /oauth/google/callback (the redirect URI registered in
// Google Cloud). No auth header, so the signed `state` says who it is for.
export const oauth = new Hono().get("/oauth/google/callback", async (c) => {
  const provider: IntegrationProvider = "google_calendar";
  const q = CallbackQuery.safeParse(c.req.query());
  const state = q.success ? verifyState(q.data.state) : null;
  if (!q.success || !state || state.provider !== provider) {
    return c.redirect(backToWeb({ integration_error: provider, reason: "expired" }));
  }
  if (q.data.error || !q.data.code) {
    // The user said no on Google's screen.
    return c.redirect(backToWeb({ integration_error: provider, reason: "declined" }, state.returnTo));
  }
  const code = q.data.code;

  return runAsUser(state.userId, async () => {
    try {
      const t = await exchangeCode(code);
      await store.saveIntegration(provider, {
        status: "connected",
        access_token: t.access_token,
        expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
        // Google only sends a refresh token with consent; keep the old one if this answer has none.
        ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}),
        scope: t.scope ?? null,
        account: emailFromIdToken(t.id_token),
        connected_at: new Date().toISOString(),
        error: null,
      });
    } catch (err) {
      // Google's redirect can land twice (a double tap on Continue, a browser reload): the first
      // exchange connects, the second finds the code spent. That is a success, not an error.
      if (!(await connectedJustNow(provider))) {
        console.error("oauth callback", err);
        return c.redirect(backToWeb({ integration_error: provider, reason: "token" }, state.returnTo));
      }
    }
    const back: Record<string, string> = { connected: provider };
    // Onboarding reads the four weeks itself, on its own screen with a status line, so the user is
    // not left waiting on Google's page (#270).
    if (state.returnTo?.startsWith("/onboarding")) {
      back.sync = "pending";
      return c.redirect(backToWeb(back, state.returnTo));
    }
    // First sync now, so the timeline fills while the user is still looking. Four weeks back, so
    // Michael can read the user's habits and suggest goals straight away (#134).
    try {
      await syncGoogleCalendar(Date.now(), PAST_DAYS);
      const { suggestions } = await currentSuggestions();
      if (suggestions.length > 0) back.goal_suggestions = String(suggestions.length);
    } catch (err) {
      console.error("first calendar sync", err);
    }
    return c.redirect(backToWeb(back, state.returnTo));
  });
});
