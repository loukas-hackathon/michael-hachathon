import { Bone, BoneGroup, Skeleton } from "@/components/skeleton";

/** Agents, loading: the headline, today's log by agent, then what each agent can do. */
export default function Loading() {
  return (
    <Skeleton title="Agents" label="Loading your agents">
      <Bone className="mt-2 h-6 w-72 max-w-full" />
      <Bone className="mt-2 h-6 w-48" />
      <Bone className="mt-6 mb-2 h-6 w-40" />
      <BoneGroup rows={4} rowHeight={44} />
      <Bone className="mt-6 mb-2 h-6 w-36" />
      <BoneGroup rows={1} rowHeight={60} />
    </Skeleton>
  );
}
