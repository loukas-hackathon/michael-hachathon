// Michael's voice for the ways a send can fail. The API's own message stays in the logs.
export function copyFor(code: string): string {
  if (code === "unavailable") return "I can't answer right now. Try again in a minute.";
  if (code === "network") return "I lost the line. Try again.";
  if (code === "upstream_error") return "I couldn't finish that answer. Try again.";
  if (code === "bad_request") return "Keep it under 2000 characters and try again.";
  if (code === "unauthorized") return "Your session ran out. Sign in again and ask me once more.";
  return "Something went wrong on my side. Try again.";
}
