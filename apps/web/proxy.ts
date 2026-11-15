import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_MISSING_MESSAGE,
  DEMO_COOKIE,
  demoVisitorId,
  E2E_COOKIE,
  e2eTestUser,
  localFallbackAllowed,
} from "./lib/auth-mode";
import { NEXT_COOKIE, safeNext } from "./lib/next-path";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
// /setup: the page a QR code opens on the iPhone. The setup token in its fragment is the credential.
const PUBLIC_PATHS = ["/login", "/auth", "/setup"];

// Refreshes the Supabase session cookie on every navigation and sends signed out visitors to
// /login. An optimistic check only: the API verifies the token on every call.
export async function proxy(request: NextRequest) {
  if (!URL_ || !KEY) {
    // Auth not configured: fine on a developer's machine (mock mode), closed on a deployment,
    // where it would otherwise make every visitor the demo account.
    if (localFallbackAllowed()) return NextResponse.next();
    return new NextResponse(AUTH_MISSING_MESSAGE, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(URL_, KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  // getClaims refreshes an expired session, then verifies the JWT locally against the project's
  // cached JWKS (ES256): no round trip to Supabase Auth on every navigation, unlike getUser.
  const { data } = await supabase.auth.getClaims();
  const testUser = e2eTestUser(request.cookies.get(E2E_COOKIE)?.value);
  const sub = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  const signedIn = Boolean(sub) || testUser !== null;

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  const isDemo = demoVisitorId(request.cookies.get(DEMO_COOKIE)?.value) !== null;
  // A session always wins: a leftover demo cookie goes, so the two never mix. Not on /auth/*,
  // where /auth/demo signs out and sets the cookie itself.
  if (signedIn && !isPublic && request.cookies.has(DEMO_COOKIE)) response.cookies.delete(DEMO_COOKIE);
  if (!signedIn && !isDemo && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    // Come back here after signing in (the connect consent page relies on it).
    const next = path === "/" ? null : safeNext(path + request.nextUrl.search);
    login.search = next ? `?next=${encodeURIComponent(next)}` : "";
    const redirect = NextResponse.redirect(login);
    // Keep what Supabase just wrote: a session whose refresh failed (an expired token of a deleted
    // account, or one revoked elsewhere) is cleared here. Dropping it left the dead cookie in place,
    // so every later navigation retried the same refresh and failed again.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    // Supabase only returns to the allow listed /auth/callback, so the way back rides in a cookie.
    // Only a real page visit sets it: a background prefetch (the tab bar's /chat) must not
    // overwrite the consent page the person came for.
    const background =
      request.headers.has("rsc") ||
      request.headers.has("next-router-prefetch") ||
      request.headers.get("sec-fetch-dest") === "empty";
    if (background) {
      // Leave the cookie as it is.
    } else if (next) {
      redirect.cookies.set(NEXT_COOKIE, next, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        // As long as an MCP authorisation request lives (apps/api/src/routes/oauth.ts).
        maxAge: 30 * 60,
      });
    } else redirect.cookies.delete(NEXT_COOKIE);
    return redirect;
  }
  if (!isPublic) {
    // Whose page this is, for the service worker's last known screen (public/sw.js, #502): a hash,
    // never the id itself, and the build that drew it.
    const visitor = demoVisitorId(request.cookies.get(DEMO_COOKIE)?.value);
    const who = testUser ? `e2e:${testUser}` : sub ? `user:${sub}` : visitor ? `demo:${visitor}` : null;
    if (who) response.headers.set("x-michael-viewer", await viewerHash(who));
    response.headers.set("x-michael-build", process.env.NEXT_PUBLIC_BUILD_ID ?? "dev");
  }
  return response;
}

async function viewerHash(who: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`michael-viewer:${who}`));
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const config = {
  // Everything except static files and images.
  // Static files, images, the PWA manifest, the service worker and its data free shell stay public so the app can be installed signed out.
  // So does the Michael shortcut: the QR setup page adds it on a phone that is not signed in.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|shell.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|shortcut)$).*)",
  ],
};
