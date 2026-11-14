import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { AUTH_MISSING_MESSAGE, DEMO_COOKIE, demoVisitorId, localFallbackAllowed } from "./lib/auth-mode";

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
  const signedIn = Boolean(data?.claims?.sub);

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
    login.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  // Everything except static files and images.
  // Static files, images, the PWA manifest and the service worker stay public so the app can be installed signed out.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
