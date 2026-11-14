/** Skeleton in the final layout of Today, so nothing jumps when the day arrives. */
export default function Loading() {
  const bar = "rounded-block bg-fill";
  return (
    <main className="screen" aria-busy="true" aria-label="Loading your day">
      <div className="flex min-h-11 items-center justify-between pt-2">
        <span className={`h-3.5 w-40 ${bar}`} />
        <span className="size-[30px] rounded-full bg-fill" />
      </div>
      <span className={`mt-1 block h-9 w-32 ${bar}`} />
      <span className={`mt-3 block h-4 w-72 max-w-full ${bar}`} />
      <span className={`mt-6 block h-16 w-40 ${bar}`} />
      <span className={`mt-2 block h-5 w-52 ${bar}`} />
      <span className={`mt-7 block h-[30px] w-full ${bar}`} />
      <span className="mt-6 block h-56 w-full rounded-card bg-fill" />
    </main>
  );
}
