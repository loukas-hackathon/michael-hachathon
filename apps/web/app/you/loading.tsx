import { Skeleton } from "@/components/skeleton";
import { ConnectionRowsSkeleton, PrivacySkeleton } from "@/components/skeletons";

/** You, loading: connections first, then privacy. Its own layout, never Today's. */
export default function Loading() {
  return (
    <Skeleton header={{ kind: "done", title: "You" }} label="Loading your settings">
      <ConnectionRowsSkeleton />
      <PrivacySkeleton />
    </Skeleton>
  );
}
