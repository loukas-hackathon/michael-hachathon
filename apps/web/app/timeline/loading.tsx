import { Skeleton } from "@/components/skeleton";
import {
  DaySummarySkeleton,
  HourGridSkeleton,
  LostWeekSkeleton,
  WeekStripSkeleton,
} from "@/components/skeletons";

/** Timeline, loading: the week's lost time, week strip, the day's heading, summary and key, then the hour grid. */
export default function Loading() {
  return (
    <Skeleton header={{ kind: "tab", title: "Timeline" }} label="Loading the timeline">
      <LostWeekSkeleton />
      <WeekStripSkeleton />
      <DaySummarySkeleton />
      <HourGridSkeleton />
    </Skeleton>
  );
}
