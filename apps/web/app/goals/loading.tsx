import { Bone, BoneGroup, Skeleton } from "@/components/skeleton";

/** Goals, loading: the answer (two lines, the bar, the action card), then a group of goal rows. */
export default function Loading() {
  return (
    <Skeleton title="Goals" label="Loading your goals">
      <Bone className="mt-3 h-6 w-64 max-w-full" />
      <Bone className="mt-2 h-6 w-48" />
      <Bone className="mt-5 h-3 w-full rounded-full" />
      <Bone className="mt-3 h-4 w-56" />
      <Bone className="mt-5 h-[148px] w-full rounded-card" />
      <Bone className="mt-6 mb-2 h-6 w-24" />
      <BoneGroup rows={2} rowHeight={92} />
    </Skeleton>
  );
}
