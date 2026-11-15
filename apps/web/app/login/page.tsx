import { Wordmark } from "@/components/brand";
import { safeNext } from "@/lib/next-path";
import { GoogleButton } from "./google-button";

export const metadata = { title: "Sign in · Michael" };

// No install hint here: before sign in it is noise. Michael asks for the Home Screen when nudges
// need it, after onboarding or the first Do it (#207).

// Reasons /auth/callback can send back, as one line each.
const ERRORS: Record<string, string> = {
  cancelled: "No problem. Sign in whenever you're ready.",
  failed: "That sign in didn't go through. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const { error, next } = await searchParams;
  const reason = typeof error === "string" ? error : undefined;
  // The demo week keeps the way back too: on stage, the Claude consent page opens signed out and
  // "See the demo week" must land on it, not on Today.
  const back = safeNext(typeof next === "string" ? next : null);
  const demoHref = back ? `/auth/demo?next=${encodeURIComponent(back)}` : "/auth/demo";
  const message = reason ? (ERRORS[reason] ?? ERRORS.failed) : null;

  return (
    // Its own full screen above the tab bar: nothing to navigate to before signing in.
    <main className="fixed inset-0 z-30 overflow-y-auto bg-bg">
      <div className="mx-auto flex min-h-full w-full max-w-[400px] flex-col px-[max(24px,env(safe-area-inset-left))] pt-[env(safe-area-inset-top)] pb-[calc(24px+env(safe-area-inset-bottom))]">
        <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
          <Wordmark className="h-9 w-auto text-label" />
          <h1 className="mt-10 text-large-title font-bold tracking-[-0.01em]">On your side.</h1>
          <p className="mt-3 max-w-[300px] text-body text-label-2">
            I find the time you lose every day and give it back to your goals.
          </p>
        </div>

        <div className="flex flex-col">
          <GoogleButton initialError={message} />
          <a
            href={demoHref}
            className="press mx-auto flex h-11 items-center px-4 text-body font-semibold text-tint-text"
          >
            See the demo week
          </a>
          <p className="mt-6 text-balance text-center text-footnote text-label-2">
            Next, Google asks to share your calendar: that's how I see your week. I work for you and nobody
            else.
          </p>
        </div>
      </div>
    </main>
  );
}
