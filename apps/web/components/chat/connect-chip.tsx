import type { ConnectorId } from "@michael/shared";
import Link from "next/link";
import { CONNECT_TARGET } from "./connect-intent";
import { KNOWLEDGE_HREF } from "./knowledge-intent";

// The one tap Connect button under Michael's answer when the person asked to connect something
// (#307). Tinted like the other chips under an answer: the chat keeps no filled buttons.
const CHIP =
  "press mt-1 inline-flex min-h-9 items-center rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text";

export function ConnectChip({ id }: { id: ConnectorId }) {
  const t = CONNECT_TARGET[id];
  // A plain link for hops that leave the app (Google, Telegram), so nothing prefetches them.
  return t.external ? (
    <a href={t.href} className={CHIP}>
      {t.label}
    </a>
  ) : (
    <Link href={t.href} className={CHIP}>
      {t.label}
    </Link>
  );
}

/** "What do you know about me?": the button to the full page, where anything can be forgotten (#379). */
export function KnowledgeChip() {
  return (
    <Link href={KNOWLEDGE_HREF} className={CHIP}>
      What I know about you
    </Link>
  );
}
