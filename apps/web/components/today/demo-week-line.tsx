import Link from "next/link";
import { isDemoVisitor, isPresenter } from "@/lib/caller";

/**
 * One quiet line under Today's title for demo visitors (#330), so nobody reads the demo week as
 * their own day. The same check and the same words as the note on You. Not for the presenter: on
 * the projector it is Manolis' week, and nobody there should be asked to sign in.
 */
export async function DemoWeekLine() {
  if (!(await isDemoVisitor()) || (await isPresenter())) return null;
  return (
    <p className="mt-1 text-footnote text-label-2">
      This is the demo week.{" "}
      <Link href="/login" className="hit press font-semibold text-label">
        Sign in to make it yours.
      </Link>
    </p>
  );
}
