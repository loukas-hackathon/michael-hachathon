import { Bone, Lines, Skeleton } from "@/components/skeleton";
import { ConnectionPageSkeleton } from "@/components/skeletons";

/** A connection's setup page, loading (components/you/connection-page.tsx). */
export default function Loading() {
  return (
    <Skeleton header={{ kind: "back", back: "You" }} label="Loading the connection">
      <div className="mt-1 flex items-center gap-3">
        <Bone className="size-8 rounded-[8px]" />
        <Lines text="large-title" widths={["11rem"]} />
      </div>
      <ConnectionPageSkeleton />
    </Skeleton>
  );
}
