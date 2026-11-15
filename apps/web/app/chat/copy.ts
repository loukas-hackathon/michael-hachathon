// Michael's voice for the ways a send can fail. The API's own message stays in the logs.
export function copyFor(code: string): string {
  if (code === "unavailable") return "I can't answer right now. Give me a minute and ask again.";
  if (code === "network") return "I lost the line. Try again.";
  if (code === "upstream_error") return "I couldn't finish that answer. Try again.";
  if (code === "bad_request") return "That's a lot to read. Keep it under 2000 characters.";
  if (code === "not_found") return "That conversation is gone. Start a new one.";
  if (code === "unauthorized") return "You've been signed out. Sign in and ask me again.";
  return "That one's on me. Try again.";
}
