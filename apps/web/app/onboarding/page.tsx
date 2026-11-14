import { OnboardingFlow } from "./flow";

export const metadata = { title: "Getting started · Michael" };

// The first talk with Michael, one question per screen. Today sends new users here (no goals yet,
// never onboarded); it can be skipped and opened again at /onboarding.
export default function OnboardingPage() {
  return <OnboardingFlow />;
}
