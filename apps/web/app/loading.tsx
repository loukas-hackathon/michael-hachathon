import { Bone, Skeleton } from "@/components/skeleton";

/** Today, loading: the final layout, so nothing jumps when the day arrives. */
export default function Loading() {
  return (
    <Skeleton label="Loading your day">
      <Bone className="mt-3 h-4 w-72 max-w-full" />
      <Bone className="mt-6 h-16 w-40" />
      <Bone className="mt-2 h-5 w-52" />
      <Bone className="mt-7 h-[30px] w-full" />
      <Bone className="mt-2.5 h-3.5 w-64 max-w-full" />
      <Bone className="mt-6 h-56 w-full rounded-card" />
    </Skeleton>
  );
}
