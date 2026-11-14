import { Bone, BoneGroup, Skeleton } from "@/components/skeleton";

/** Goals, loading: the week line, one group of goal rows, then the maths. */
export default function Loading() {
  return (
    <Skeleton title="Goals" label="Loading your goals">
      <Bone className="mt-2 h-4 w-72 max-w-full" />
      <Bone className="mt-6 mb-2 h-6 w-24" />
      <BoneGroup rows={3} rowHeight={96} />
      <Bone className="mt-6 mb-2 h-6 w-28" />
      <Bone className="h-28 w-full rounded-group" />
    </Skeleton>
  );
}
