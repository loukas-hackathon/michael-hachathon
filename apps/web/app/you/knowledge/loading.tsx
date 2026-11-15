import { Skeleton } from "@/components/skeleton";
import { KnowledgeSkeleton } from "@/components/skeletons";

/** What I know about you, loading: its own layout, never You's or Today's. */
export default function Loading() {
  return (
    <Skeleton
      header={{ kind: "back", back: "You", title: "What I know about you" }}
      label="Loading what I know"
    >
      <KnowledgeSkeleton />
    </Skeleton>
  );
}
