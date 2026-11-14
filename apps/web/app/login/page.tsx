import { Wordmark } from "@/components/brand";
import { GoogleButton } from "./google-button";

export const metadata = { title: "Sign in · Michael" };

export default function LoginPage() {
  return (
    <main className="screen flex min-h-dvh flex-col justify-center pb-24">
      <Wordmark className="h-10 w-auto text-label" />
      <p className="mt-6 text-title3 font-semibold">On your side.</p>
      <p className="mt-2 text-body text-label-2">
        I find the time you lose every day and give it back to your goals.
      </p>

      <div className="mt-10 flex flex-col gap-3">
        <GoogleButton />
        <a
          href="/auth/demo"
          className="press flex h-12 items-center justify-center rounded-group bg-fill text-body font-semibold text-tint-text"
        >
          Try the demo week
        </a>
      </div>
      <p className="mt-4 text-footnote text-label-2">
        One client: I work for you only. Your timeline is yours to see and delete.
      </p>
    </main>
  );
}
