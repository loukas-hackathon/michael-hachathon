import { warmChat } from "@/lib/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /chat/warm { thread_id? }: the chat screen is open, so the API reads the day and warms the
// model now, not when the question arrives (#364). Always 204: a warm up that fails costs nothing.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { thread_id?: unknown } | null;
  const threadId =
    typeof body?.thread_id === "string" && (body.thread_id === "new" || UUID.test(body.thread_id))
      ? body.thread_id
      : undefined;
  await warmChat(threadId).catch(() => {});
  return new Response(null, { status: 204 });
}
