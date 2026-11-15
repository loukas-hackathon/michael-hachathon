"use client";

import { useEffect, useState } from "react";

// The status line under onboarding's skeleton. Reading four weeks of calendar can pass a few
// seconds, so the line moves on in plain words (michael-feedback, rule 12). Fixed height, so a new
// line never moves anything below it.

const STEPS = ["Reading your calendar", "Looking back four weeks", "Finding what your week is for"];

export function ReadingStatus() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (i >= STEPS.length - 1) return;
    const t = setTimeout(() => setI(i + 1), 2500);
    return () => clearTimeout(t);
  }, [i]);
  return (
    <span key={i} role="status" className="m-swap block min-h-[1.375em]">
      {STEPS[i]}
    </span>
  );
}
