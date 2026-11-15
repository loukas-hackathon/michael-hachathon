import { Skeleton } from "@/components/skeleton";
import { ChatHistorySkeleton, CheckInSkeleton, ComposerSkeleton } from "@/components/skeletons";

/** Chat, loading: the conversation's bubbles and the message field where they will be. */
export default function Loading() {
  return (
    <Skeleton
      header={{ kind: "tab", title: "Chat", actions: 2 }}
      label="Loading the conversation"
      className="flex min-h-dvh flex-col"
    >
      <CheckInSkeleton />
      <div className="flex-1">
        <ChatHistorySkeleton />
      </div>
      <ComposerSkeleton />
    </Skeleton>
  );
}
