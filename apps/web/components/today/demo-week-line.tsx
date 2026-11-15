import Link from "next/link";
import { isDemoVisitor } from "@/lib/caller";

/**
 * One quiet line under Today's title for demo visitors (#330), so nobody reads the demo week as
 * their own day. The same check and the same words as the note on You.
 */
export async function DemoWeekLine() {
  if (!(await isDemoVisitor())) return null;
  return (
    <p className="mt-1 text-footnote text-label-2">
      This is the demo week.{" "}
      <Link href="/login" className="hit press font-semibold text-label">
        Sign in to make it yours.
      </Link>
    </p>
  );
}
