import { Skeleton } from "@/components/skeleton";
import { DaySummarySkeleton, HourGridSkeleton, WeekStripSkeleton } from "@/components/skeletons";

/** Timeline, loading: week strip, the day's heading, summary and key, then the hour grid. */
export default function Loading() {
  return (
    <Skeleton header={{ kind: "tab", title: "Timeline" }} label="Loading the timeline">
      <WeekStripSkeleton />
      <DaySummarySkeleton />
      <HourGridSkeleton />
    </Skeleton>
  );
}
