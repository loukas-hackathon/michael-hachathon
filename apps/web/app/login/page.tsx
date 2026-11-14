import { Wordmark } from "@/components/brand";
import { InstallApp } from "@/components/install-app";
import { GoogleButton } from "./google-button";

export const metadata = { title: "Sign in · Michael" };

// Reasons /auth/callback can send back, as one line each.
const ERRORS: Record<string, string> = {
  cancelled: "Sign in cancelled. Try again when you're ready.",
  failed: "That sign in didn't go through. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const reason = typeof error === "string" ? error : undefined;
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
            href="/auth/demo"
            className="press mx-auto flex h-11 items-center px-4 text-body font-semibold text-tint-text"
          >
            See the demo week
          </a>
          <div className="mt-4">
            <InstallApp />
          </div>
          <p className="mt-6 text-balance text-center text-footnote text-label-2">
            I work for you only. Your timeline is yours to see and delete.
          </p>
        </div>
      </div>
    </main>
  );
}
