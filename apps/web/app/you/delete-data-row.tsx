import Link from "next/link";

// One row on You that leads to /you/delete. Its own file, so the You layout can move freely.
export function DeleteDataRow() {
  return (
    <Link
      href="/you/delete"
      className="press mt-4 flex h-12 items-center justify-between rounded-group bg-fill px-4 text-body font-semibold text-danger"
    >
      Delete my data
      <span aria-hidden="true" className="text-label-2">
        ›
      </span>
    </Link>
  );
}
