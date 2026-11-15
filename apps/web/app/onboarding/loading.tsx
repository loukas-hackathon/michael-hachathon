import { Bone, BoneGroup } from "@/components/skeleton";
import { OnboardingFrame } from "./frame";
import { ReadingStatus } from "./reading-status";

/**
 * Onboarding, loading: the same frame as both screens, bones where the goals land, and a status line
 * that says what is happening. Straight back from Google this covers the four week read, so the
 * wait sits here, on our screen, and never on Google's (#270).
 */
export default function Loading() {
  return (
    <div className="m-skeleton" aria-busy="true">
      <OnboardingFrame
        step={0}
        title={<Bone className="mt-1 h-9 w-64 max-w-full" />}
        line={<ReadingStatus />}
        footer={<Bone className="h-[50px] w-full rounded-full" />}
      >
        <BoneGroup rows={4} rowHeight={68} />
      </OnboardingFrame>
    </div>
  );
}
