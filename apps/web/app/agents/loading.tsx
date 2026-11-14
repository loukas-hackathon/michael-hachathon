import { Bone, BoneGroup, Skeleton } from "@/components/skeleton";

/** Agents, loading: who asked today, the allowed agents, then today's questions. */
export default function Loading() {
  return (
    <Skeleton title="Agents" label="Loading your agents">
      <Bone className="mt-2 h-4 w-72 max-w-full" />
      <Bone className="mt-6 mb-2 h-6 w-24" />
      <BoneGroup rows={2} />
      <Bone className="mt-6 mb-2 h-6 w-20" />
      <BoneGroup rows={3} rowHeight={60} />
    </Skeleton>
  );
}
