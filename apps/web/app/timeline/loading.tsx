import { Bone, Skeleton } from "@/components/skeleton";

const HOURS = 9;

/** Timeline, loading: week strip, the day's line, then the hour grid with a few grey blocks. */
export default function Loading() {
  return (
    <Skeleton title="Timeline" label="Loading the timeline">
      <div aria-hidden="true" className="mt-2.5 grid grid-cols-7 justify-items-center gap-y-1 py-1">
        {Array.from({ length: 7 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder days
          <span key={i} className="flex flex-col items-center gap-1">
            <Bone className="h-2.5 w-2.5" />
            <span className="m-bone size-[34px] rounded-full" />
          </span>
        ))}
      </div>
      <Bone className="mt-4 h-6 w-56" />
      <Bone className="mt-2 h-4 w-80 max-w-full" />
      <Bone className="mt-1.5 h-4 w-64 max-w-full" />
      <div aria-hidden="true" className="relative mt-6" style={{ height: HOURS * 50 }}>
        {Array.from({ length: HOURS }, (_, h) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder hours
          <span key={h} className="absolute inset-x-0 flex items-center gap-2" style={{ top: h * 50 }}>
            <Bone className="h-2.5 w-7" />
            <span className="h-[0.5px] flex-1 bg-separator" />
          </span>
        ))}
        <Bone className="absolute right-4 left-[50px] top-[30px] h-[70px]" />
        <Bone className="absolute right-4 left-[50px] top-[130px] h-[34px]" />
        <Bone className="absolute right-4 left-[50px] top-[190px] h-[120px]" />
        <Bone className="absolute right-4 left-[50px] top-[340px] h-[48px]" />
      </div>
    </Skeleton>
  );
}
