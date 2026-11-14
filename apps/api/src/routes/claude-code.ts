import { createHash } from "node:crypto";
import { aiPromptTitle, claudeCodePromptExternalId, EventInput, isTypedPrompt } from "@michael/shared";
import type { Context } from "hono";
import { z } from "zod";
import { store } from "../store";

// POST /v1/webhooks/claude-code: the live half of the Claude Code source. Claude Code posts its
// hook payload here (`type: "http"` hooks in ~/.claude/settings.json, see the README). The history
// half is the `claude-code` reader in apps/collector, which later backfills the same prompts from
// the transcripts under the same external_id.
//
// Two rules shape this handler:
// 1. Claude Code waits for the answer, so it must be fast and must never look like a failure.
//    Every authenticated request gets `204` with an empty body. An empty body matters: Claude Code
//    reads a JSON body as hook output and reports one it does not recognise as a hook error.
//    What happened is in the `x-michael-result` header: stored, duplicate, ignored or error.
// 2. Privacy. Hook payloads can carry tool input, tool output and the assistant's answer. The
//    schema below names the only fields we read; zod drops the rest before anything is stored.

const HookPayload = z.object({
  hook_event_name: z.string().min(1),
  session_id: z.string().min(1),
  prompt_id: z.string().min(1).optional(),
  cwd: z.string().optional(),
  // UserPromptSubmit
  prompt: z.string().optional(),
  // Notification
  notification_type: z.string().optional(),
});

// The notifications that mean "Claude Code is waiting for the person": it needs an approval, or it
// finished about a minute ago and nothing was typed since.
const WAITING = new Set(["permission_prompt", "idle_prompt"]);

const project = (cwd: string | undefined) => cwd?.split(/[\\/]/).filter(Boolean).pop() ?? "unknown";

function toEvent(hook: z.infer<typeof HookPayload>, arrivedAt: Date): z.input<typeof EventInput> | null {
  // Payloads carry no timestamp, so the time of arrival is the time of the event.
  const at = arrivedAt.toISOString();
  const data = { tool: "claude_code", session_id: hook.session_id, project: project(hook.cwd) };

  if (hook.hook_event_name === "UserPromptSubmit") {
    const prompt = hook.prompt ?? "";
    // This hook also fires for background task reports and typed slash commands. Keep typed prompts.
    if (!isTypedPrompt(prompt)) return null;
    // Older versions send no prompt_id. Then a retry within the same minute still collapses, but
    // the transcript backfill cannot be matched and will add its own event.
    const fallback = `live:${createHash("sha256").update(prompt).digest("hex").slice(0, 12)}:${at.slice(0, 16)}`;
    return {
      source: "claude_code",
      type: "ai_prompt",
      start_at: at,
      end_at: null,
      title: aiPromptTitle(prompt),
      data,
      external_id: claudeCodePromptExternalId(hook.session_id, hook.prompt_id ?? fallback),
    };
  }

  if (hook.hook_event_name === "Notification" && WAITING.has(hook.notification_type ?? "")) {
    return {
      source: "claude_code",
      // Same shape as a Mac notification: the title is the app that raised it.
      type: "notification",
      start_at: at,
      end_at: null,
      title: "Claude Code",
      // The notification text is not stored: it can name a tool or a command.
      data: { ...data, kind: hook.notification_type },
      // No id in the payload. One per session, kind and second is enough to absorb a retry.
      external_id: `cc:${hook.session_id}:notify:${hook.notification_type}:${at.slice(0, 19)}`,
    };
  }

  // Stop, SessionEnd and anything else: accepted, not stored. They need an event type of their
  // own ("the turn ended", "the session ended"); until then the transcript reader supplies the
  // session numbers once a work stretch closes.
  return null;
}

export async function claudeCodeHook(c: Context) {
  const arrivedAt = new Date();
  let result = "ignored";
  try {
    const hook = HookPayload.safeParse(await c.req.json().catch(() => null));
    const event = hook.success ? toEvent(hook.data, arrivedAt) : null;
    if (event) {
      const { inserted, duplicates } = await store.insertEvents([EventInput.parse(event)]);
      result = inserted.length > 0 ? "stored" : duplicates > 0 ? "duplicate" : "ignored";
    }
  } catch (error) {
    // Never fail a session over our own trouble. The transcript reader fills the gap later.
    console.error("claude-code hook:", (error as Error).message);
    result = "error";
  }
  c.header("x-michael-result", result);
  return c.body(null, 204);
}
