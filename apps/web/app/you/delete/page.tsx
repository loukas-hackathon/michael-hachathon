import Link from "next/link";
import { DeleteFlow } from "./delete-flow";

export const metadata = { title: "Delete my data · Michael" };

// "Deletion really deletes" (AGENTS.md Privacy): DELETE /v1/me/data, behind a two step confirm.
export default function DeletePage() {
  return (
    <main className="screen">
      <header className="flex min-h-11 items-center justify-end pt-2">
        <Link
          href="/you"
          className="press -mr-2 flex h-11 items-center px-2 text-body font-semibold text-tint-text"
        >
          Done
        </Link>
      </header>
      <h1 className="text-large-title font-bold tracking-[0.01em]">Delete my data</h1>
      <p className="mt-1 text-subhead text-label-2">
        Everything I hold about you, gone from the database. After 90 days I keep only daily totals anyway.
      </p>
      <DeleteFlow />
    </main>
  );
}
