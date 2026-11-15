// "What do you know about me?" in chat gets a button to the full page under Michael's answer
// (#379), read from the person's own words like the Connect button, so it never depends on the model.

const PATTERNS = [
  /\bwhat (?:do|did|else do) (?:you|michael) (?:know|remember|keep|store|have) (?:about|on) me\b/i,
  /\bwhat (?:have|has) (?:you|michael) (?:got|kept|stored|remembered) (?:about|on) me\b/i,
  /\bwhat do you know of me\b/i,
  /\b(?:show|tell) me (?:everything |all )?(?:what )?you (?:know|remember|keep) about me\b/i,
  /\bmy data\b.*\b(?:you have|you keep|you hold)\b/i,
];

export const KNOWLEDGE_HREF = "/you/knowledge";

/** True when the message asks what Michael knows about the person. */
export function knowledgeIntent(text: string): boolean {
  return PATTERNS.some((re) => re.test(text));
}
