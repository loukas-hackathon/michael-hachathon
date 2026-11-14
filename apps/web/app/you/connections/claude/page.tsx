import Link from "next/link";
import { ClaudeLink } from "@/components/agents/connect-claude";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { MCP_URL } from "@/lib/connect";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Claude · Michael" };

export default async function ClaudePage() {
  const { row } = await getConnection("claude");
  return (
    <ConnectionPage row={row}>
      <ClaudeLink url={MCP_URL} />
      <SetupSection title="Who asked about you">
        <Link
          href="/agents"
          className="press flex h-12 items-center justify-between rounded-group bg-fill px-4 text-body"
        >
          What Claude asked today, and what it may see
          <span aria-hidden="true" className="text-label-2">
            ›
          </span>
        </Link>
      </SetupSection>
    </ConnectionPage>
  );
}
