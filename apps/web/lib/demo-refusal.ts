import "server-only";
import { isDemoVisitor } from "./caller";

// One line for every tap the API refuses on the demo week (#330). The API answers 403 to a demo
// visitor for anything that would change the shared demo account (apps/api/src/demo/visitor.ts).
// A server action hands the status it got to demoRefusal and shows the line next to the control,
// so a refusal reads the same on every screen and never as a generic error.

/** Must match DEMO_VISITOR_MESSAGE in apps/api/src/demo/visitor.ts. */
export const DEMO_WEEK_LINE = "This is the demo week. Sign in with Google to make it yours.";

/** The demo line when the API refused a demo visitor (403), else null: the caller keeps its own words. */
export async function demoRefusal(status: number | undefined): Promise<string | null> {
  return status === 403 && (await isDemoVisitor()) ? DEMO_WEEK_LINE : null;
}
