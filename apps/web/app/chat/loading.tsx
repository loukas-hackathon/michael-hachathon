import { Bone, Skeleton } from "@/components/skeleton";

/** Chat, loading: a few bubbles and the message box where it will sit. */
export default function Loading() {
  return (
    <Skeleton title="Chat" label="Loading the chat">
      <div aria-hidden="true" className="mt-6 flex flex-col gap-2">
        <Bone className="h-10 w-2/3 self-end rounded-card" />
        <Bone className="h-16 w-4/5 rounded-card" />
        <Bone className="h-10 w-1/2 self-end rounded-card" />
        <Bone className="h-24 w-4/5 rounded-card" />
      </div>
      <Bone className="mt-6 h-12 w-full rounded-card" />
    </Skeleton>
  );
}
