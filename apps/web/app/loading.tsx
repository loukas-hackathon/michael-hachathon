import { Skeleton } from "@/components/skeleton";
import {
  ActionSkeleton,
  FoldRowsSkeleton,
  MichaelCardSkeleton,
  TodayScoreSkeleton,
  TodayWeekSkeleton,
} from "@/components/skeletons";

/** Today, loading: the score first, then the one next move, then what I did, then the quiet rows. */
export default function Loading() {
  return (
    <Skeleton label="Loading your day">
      <TodayWeekSkeleton />
      <TodayScoreSkeleton />
      <ActionSkeleton />
      <MichaelCardSkeleton />
      <FoldRowsSkeleton />
    </Skeleton>
  );
}
