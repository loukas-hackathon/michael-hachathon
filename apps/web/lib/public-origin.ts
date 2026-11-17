// The address people reach us at. Behind Railway's proxy `request.url` holds the server's own
// address (https://localhost:8080), so redirects built from it send people nowhere. The proxy's
// forwarded host and protocol name the real one; Vercel and local dev agree with request.url.

type HeaderSource = { headers: Headers; url: string };

/** "https://web.example.app", from the forwarded headers when present, else request.url. */
export const publicOrigin = (request: HeaderSource): string => {
  const fallback = new URL(request.url);
  const first = (value: string | null) => value?.split(",")[0]?.trim() || null;
  const host = first(request.headers.get("x-forwarded-host")) ?? first(request.headers.get("host"));
  if (!host) return fallback.origin;
  const proto = first(request.headers.get("x-forwarded-proto")) ?? fallback.protocol.replace(":", "");
  return `${proto}://${host}`;
};

/** A URL on our public address: use it in place of `new URL(path, request.url)`. */
export const publicUrl = (path: string, request: HeaderSource): URL => new URL(path, publicOrigin(request));
