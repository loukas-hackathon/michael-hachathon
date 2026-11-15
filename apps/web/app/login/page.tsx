import { InstallApp } from "@/components/install-app";
import { Michael } from "@/components/michael";
import { safeNext } from "@/lib/next-path";
import { EmailForm } from "./email-form";
import { ForgetDevice } from "./forget-device";
import "./login.css";

export const metadata = { title: "Sign in · Michael" };

// The first screen (#492): Michael, one promise, one quiet glimpse of the product, one way in.
// Email and password only (#475): no Google here, and it never leaves the installed app. Google
// comes after sign in, as Connect Google Calendar. One quiet "Get the app" line, only in a browser
// tab (#460); the full nudge ask still waits for the first Do it (#207).

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
    <main className="m-login fixed inset-0 z-30 overflow-y-auto bg-bg">
      <div className="mx-auto flex min-h-full w-full max-w-[400px] flex-col px-[max(24px,env(safe-area-inset-left))] pt-[var(--m-safe-top)] pb-[calc(16px+env(safe-area-inset-bottom))] lg:max-w-[1000px] lg:flex-row lg:items-center lg:gap-24 lg:px-12">
        <section className="flex flex-1 flex-col items-center justify-center py-12 text-center lg:items-start lg:text-left">
          <Michael state="idle" className="h-auto w-[76px] text-label lg:w-[112px]" />
          <h1 className="mt-8 text-large-title font-bold tracking-[-0.01em] lg:mt-10 lg:text-[52px] lg:leading-[56px] lg:tracking-[-0.02em]">
            On your side.
          </h1>
          <p className="mt-3 max-w-[300px] text-body text-label-2 lg:max-w-[380px] lg:text-insight">
            I find the time you lose every day and give it back to your goals.
          </p>
          <Glimpse />
        </section>

        <section aria-label="Sign in" className="flex flex-col lg:w-[360px] lg:shrink-0">
          <ForgetDevice />
          <EmailForm next={back} initialError={message} />
          <a
            href={demoHref}
            className="press mx-auto mt-2 flex h-11 items-center rounded-control px-4 text-body font-semibold text-label"
          >
            See the demo week
          </a>
          <InstallApp />
        </section>
      </div>
    </main>
  );
}

/**
 * A quiet glimpse of what Michael does, marked as a sample: the tape (docs/design-guide.md) of a
 * day, goal time spent in pink, lost time hatched, the rest still ahead, and its number first.
 * Spent 62 and lost 14 of 100: 82% of the goal time so far. The only pink on the screen.
 */
function Glimpse() {
  return (
    <div className="m-login-glimpse w-full max-w-[260px]">
      <div>
        <figure className="pt-10">
          <div
            aria-hidden="true"
            className="relative h-2 overflow-hidden rounded-full shadow-[inset_0_0_0_1px_var(--m-label-2)]"
          >
            <span className="m-login-spent absolute inset-y-0 left-0 w-[62%] bg-spark" />
            <span className="hatch absolute inset-y-0 left-[62%] w-[14%] bg-bg shadow-[inset_0_1px_0_var(--m-label-2),inset_0_-1px_0_var(--m-label-2)]" />
          </div>
          <figcaption className="mt-2.5 text-balance text-footnote text-label-2">
            <span className="tnum font-semibold text-label">82%</span> of goal time kept. A sample day.
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
