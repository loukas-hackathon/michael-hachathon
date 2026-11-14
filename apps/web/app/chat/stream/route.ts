import { openChatStream } from "@/lib/api";

// POST /chat/stream { message }: passes the API's server-sent events through to the browser, so the
// browser never holds the API key or the user's token. Errors come back as ApiError JSON.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) : "";
  if (!message) return error(400, "bad_request", "Type a question first");

  let upstream: Response;
  try {
    upstream = await openChatStream(message);
  } catch (err) {
    console.error("chat stream:", err);
    // bearer() throws when signed out; fetch throws when the API is down.
    const signedOut = err instanceof Error && err.message === "Not signed in";
    return signedOut
      ? error(401, "unauthorized", "Not signed in")
      : error(502, "network", "Could not reach the API");
  }
  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

function error(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}
