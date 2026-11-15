import { Skeleton } from "@/components/skeleton";
import { GoalGroupSkeleton, GoalsTopSkeleton } from "@/components/skeletons";

/** Goals, loading: the week line, target and balance, then the goal rows by area. */
export default function Loading() {
  return (
    <Skeleton header={{ kind: "tab", title: "Goals", actions: 1 }} label="Loading your goals">
      <GoalsTopSkeleton />
      <GoalGroupSkeleton rows={2} />
      <GoalGroupSkeleton rows={2} title="5rem" />
    </Skeleton>
  );
}
