/**
 * Michael's answers are light Markdown (bold, lists, links). Where a line is shown as plain text,
 * such as a conversation's preview in the list, the marks must not show: "**2h 01 of 6h**" reads
 * as noise. Works on text whose line breaks were already collapsed, too (stored previews).
 */
export function plainText(md: string): string {
  return (
    md
      // Links and images keep their text.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Headings, bullets and numbered items at the start of a line.
      .replace(/^[ \t]*(#{1,6}[ \t]+|[-*•][ \t]+|\d+[.)][ \t]+|>[ \t]?)/gm, "")
      // A bullet after a collapsed line break: "to go. - Calendar:".
      .replace(/([.!?:])\s+[-*•]\s+/g, "$1 ")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_]([^\s*_][^*_]*?)[*_](?=$|[\s.,;:!?)])/g, "$1$2")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}
