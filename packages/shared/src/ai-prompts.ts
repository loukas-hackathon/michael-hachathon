// Rules for turning a prompt typed into an AI coding tool into a timeline event. Shared by the
// transcript reader (apps/collector) and the live hook webhook (apps/api), so the same prompt gets
// the same title and the same external_id whichever route sees it first.
// Pure string functions only: this file is also bundled into the web app.

export const AI_PROMPT_TITLE_MAX = 120;
export const AI_SESSION_TITLE_MAX = 80;

/** Title used when a prompt holds only an image, a file or pasted text and nothing typed. */
export const AI_PROMPT_NO_TEXT = "Prompt without typed text";

/** `(source, external_id)` is unique, so the live hook and the later transcript backfill of the same prompt collapse into one event. */
export const claudeCodePromptExternalId = (sessionId: string, promptId: string) =>
  `cc:${sessionId}:prompt:${promptId}`;

// Blocks that Claude Code or an editor adds around what the person typed. Their content is dropped
// from titles: it is pasted material or machine context, not the person's own words.
const WRAPPER_TAGS = ["pasted_content", "ide_opened_file", "ide_selection", "system-reminder"];

// A "user" message that opens with one of these was written by the tool, not typed as a prompt:
// background task reports, slash command wrappers and their output, interrupt markers.
// The last alternative is a slash command exactly as typed (`/name` or `/name args`), which is how
// a hook receives it. A path such as `/Users/me/file` does not match: no space after the first word.
const NOT_TYPED =
  /^\s*(?:<(?:task-notification|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|system-reminder|user-prompt-submit-hook)\b|\[Request interrupted by user|\/[\w:-]+(?:\s|$))/;

/** False when the text is tool-generated or a slash command, true for something a person typed (or an empty prompt that carried only an attachment). */
export function isTypedPrompt(text: string): boolean {
  return !NOT_TYPED.test(text.slice(0, 400));
}

// Done with indexOf rather than a regular expression: pasted blocks can be megabytes long.
function stripWrappers(text: string): string {
  let out = text;
  for (const tag of WRAPPER_TAGS) {
    let start = out.indexOf(`<${tag}`);
    while (start !== -1) {
      const close = out.indexOf(`</${tag}`, start);
      const end = close === -1 ? -1 : out.indexOf(">", close);
      // No closing tag: treat the rest as wrapped content.
      out = end === -1 ? out.slice(0, start) : `${out.slice(0, start)} ${out.slice(end + 1)}`;
      start = end === -1 ? -1 : out.indexOf(`<${tag}`, start);
    }
  }
  return out;
}

const MASK = "[secret]";
const mixed = (s: string) => /[0-9]/.test(s) && /[A-Za-z]/.test(s);

/**
 * Masks anything that looks like a credential before a prompt is stored. Deliberately greedy:
 * a false positive only hides a few characters of a title, a miss stores a secret.
 */
export function scrubSecrets(text: string): string {
  return (
    text
      // PEM blocks.
      .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?(?:-----END [A-Z ]+-----|$)/g, MASK)
      // Well known key prefixes: OpenAI and Anthropic style, GitHub, Slack, AWS, Google, Stripe.
      .replace(/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{8,}/g, MASK)
      .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/g, MASK)
      .replace(/\bxox[abeprs]-[A-Za-z0-9-]{8,}/g, MASK)
      .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, MASK)
      .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, MASK)
      // JSON Web Tokens.
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g, MASK)
      // "Bearer <token>" and "password: <value>" style pairs: keep the label, hide the value.
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`)
      .replace(
        /\b((?:api[_-]?key|access[_-]?key|secret|token|password|passwd|pwd)\w*["']?\s*[:=]\s*)["']?[^\s"',;]{4,}/gi,
        `$1${MASK}`,
      )
      // Credentials inside a URL: scheme://user:password@host
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, `$1${MASK}@`)
      // Anything else long and random looking: hex, base62, base64.
      .replace(/[A-Za-z0-9_]{32,}/g, (m) => (mixed(m) ? MASK : m))
      .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, (m) => (mixed(m) ? MASK : m))
  );
}

/**
 * The stored title of a prompt: what the person typed, on one line, secrets masked, cut to `max`
 * characters. Never returns an empty string.
 */
export function aiPromptTitle(text: string, max: number = AI_PROMPT_TITLE_MAX): string {
  // Cut before the scrub (cheap on huge prompts) but far beyond `max`, so a secret that straddles
  // the final cut is still seen whole by the scrub.
  const typed = stripWrappers(text).slice(0, 4000).replace(/\s+/g, " ").trim();
  const title = scrubSecrets(typed).slice(0, max).trim();
  return title || AI_PROMPT_NO_TEXT;
}
