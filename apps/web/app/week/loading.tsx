import { Skeleton } from "@/components/skeleton";
import { MichaelCardSkeleton, TodayScoreSkeleton } from "@/components/skeletons";

/** Your week, loading: the score and its maths, then Michael's lesson. */
export default function Loading() {
  return (
    <Skeleton header={{ kind: "back", back: "Today", title: "Your week" }} label="Loading your week">
      <TodayScoreSkeleton />
      <MichaelCardSkeleton />
    </Skeleton>
  );
}
