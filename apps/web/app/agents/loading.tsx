import { Skeleton } from "@/components/skeleton";
import { AgentRowsSkeleton, AgentsHeadlineSkeleton, AgentsLogSkeleton } from "@/components/skeletons";

/** Agents, loading: the headline, who asked today by agent, then what each agent can do. */
export default function Loading() {
  return (
    <Skeleton
      header={{ kind: "back", back: "You", title: "Agents" }}
      label="Loading your agents"
      className="screen-mid"
    >
      <AgentsHeadlineSkeleton />
      <AgentsLogSkeleton />
      <AgentRowsSkeleton />
    </Skeleton>
  );
}
