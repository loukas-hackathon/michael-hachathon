import Link from "next/link";
import { ClaudeLink } from "@/components/agents/connect-claude";
import { ConnectionPage, SetupSection } from "@/components/you/connection-page";
import { MCP_URL } from "@/lib/connect";
import { getConnection } from "@/lib/connections-status";

export const metadata = { title: "Claude · Michael" };

export default async function ClaudePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const { row } = await getConnection("claude");
  return (
    <ConnectionPage row={row} from={from}>
      <ClaudeLink url={MCP_URL} />
      <SetupSection title="Who asked about you">
        <Link
          href="/agents"
          className="press flex h-12 items-center justify-between rounded-group bg-fill px-4 text-body"
        >
          What Claude asked today, and what it may see
          <span className="text-label-2">›</span>
        </Link>
      </SetupSection>
    </ConnectionPage>
  );
}
