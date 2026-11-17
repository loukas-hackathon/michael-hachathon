import { Suspense } from "react";
import { WaitFor, WaitScreen } from "./wait";

/**
 * Onboarding, loading: Michael thinking, saying what he is doing for the screen that comes next
 * (the talk, the usual goals, the week and its connections). Straight back from Google this covers
 * the four week read, so the wait sits here, on our screen, and never on Google's (#270). Invisible
 * for its first 200ms, so a quick step never flashes it.
 */
export default function Loading() {
  return (
    <div className="m-wait-in" aria-busy="true">
      <Suspense fallback={<WaitScreen kind="talk" />}>
        <WaitFor />
      </Suspense>
    </div>
  );
}
