import { Lines, Skeleton } from "@/components/skeleton";

/**
 * Traction, loading: the final layout, so nothing shifts when the numbers land. The headline
 * number and its sentence, the copy button, then the two growth charts at their exact heights.
 */
export default function Loading() {
  return (
    <Skeleton
      header={{ kind: "back", back: "Today", title: "Waiting list" }}
      label="Loading traction"
      className="screen-wide"
    >
      <section aria-hidden="true" className="mt-3">
        <Lines text="score" widths={["6rem"]} />
        <Lines text="insight" widths={["16rem", "11rem"]} />
        <span className="m-bone mt-4 block h-11 w-[190px] rounded-full" />
        <span className="mt-2 block h-[18px]" />
      </section>
      <div aria-hidden="true" className="mt-8 grid gap-8 lg:grid-cols-2 lg:gap-6">
        {[0, 1].map((i) => (
          <div key={i}>
            <Lines text="subhead" widths={["10rem"]} />
            <span className="m-bone mt-3 block h-40 w-full rounded-control lg:h-[200px]" />
          </div>
        ))}
      </div>
    </Skeleton>
  );
}
