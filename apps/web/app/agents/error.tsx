"use client";

import { ScreenHeader } from "@/components/screen";

/** Says what went wrong and how to fix it, without apology. */
export default function AgentsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="screen">
      <ScreenHeader context="Who asks about you" title="Agents" />
      <section className="mt-8 flex flex-col gap-2 rounded-card bg-fill px-4 pt-4 pb-5">
        <h2 className="text-title3 font-bold">Michael couldn't load who asked about you.</h2>
        <p className="text-subhead text-label-2">Your data is safe. Check your connection and try again.</p>
        <div className="mt-2">
          <button
            type="button"
            onClick={reset}
            className="press min-h-9 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint"
          >
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
