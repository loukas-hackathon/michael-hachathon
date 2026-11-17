import { Group, Lines, RowRule, Skeleton } from "@/components/skeleton";

/** Traction, loading: the sign ups headline and its four rows, then the copy button, as on the page. */
export default function Loading() {
  return (
    <Skeleton
      header={{ kind: "back", back: "Today", title: "Traction" }}
      label="Loading traction"
      className="screen-mid"
    >
      <section aria-hidden="true" className="mt-3">
        <Lines text="score" widths={["6rem"]} />
        <Lines text="title3" widths={["14rem"]} />
        <Group className="mt-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="relative flex min-h-12 items-center justify-between gap-3 px-4 py-2.5">
              {i > 0 ? <RowRule /> : null}
              <span>
                <Lines text="body" widths={["8rem"]} />
                <Lines text="footnote" widths={["10rem"]} />
              </span>
              <Lines text="body" widths={["3rem"]} />
            </div>
          ))}
        </Group>
      </section>
      <div className="mt-4">
        <span className="m-bone block h-11 w-[180px] rounded-full" />
      </div>
    </Skeleton>
  );
}
