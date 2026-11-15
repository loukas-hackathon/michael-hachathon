import { openChatStream } from "@/lib/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /chat/stream { message, spoken?, thread_id? }: passes the API's server-sent events through to
// the browser, so the browser never holds the API key or the user's token. Errors come back as
// ApiError JSON.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    spoken?: unknown;
    thread_id?: unknown;
  } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) : "";
  if (!message) return error(400, "bad_request", "Type a question first");
  // A thread id or "new"; anything else is dropped and the API writes in the latest thread.
  const threadId =
    typeof body?.thread_id === "string" && (body.thread_id === "new" || UUID.test(body.thread_id))
      ? body.thread_id
      : undefined;

  let upstream: Response;
  try {
    upstream = await openChatStream(message, { spoken: body?.spoken === true, threadId });
  } catch (err) {
    console.error("chat stream:", err);
    // authHeaders() throws when signed out; fetch throws when the API is down.
    const signedOut = err instanceof Error && err.message === "Not signed in";
    return signedOut
      ? error(401, "unauthorized", "Not signed in")
      : error(502, "network", "Could not reach the API");
  }
  if (upstream.status === 503) {
    // Chat not switched on yet (no model key) is a state, not a fault: answer it as the stream's own
    // error event so the browser shows the calm line without logging a failed request.
    return new Response(`event: error\ndata: ${(await upstream.text()).replace(/\n/g, " ")}\n\n`, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
    });
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
