import { OnboardingTurnRequest } from "@michael/shared";
import { Hono } from "hono";
import { currentDemoVisitor, currentUserId } from "../context";
import { HttpError, jsonBody, parse } from "../http";
import { onboardingTurn } from "../onboarding/turn";
import { rateLimiter } from "../rate-limit";

// A talk is an opener and at most five answers, each a model call: room for a retry or two.
export const onboardingTurnLimit = rateLimiter(20, 60_000);

export const onboarding = new Hono()
  // Michael's next line in the first talk (voice agent). Reads only: nothing is saved here.
  .post("/onboarding/turn", async (c) => {
    const { turns } = parse(OnboardingTurnRequest, await jsonBody(c));
    if (!onboardingTurnLimit.take(currentDemoVisitor() ?? currentUserId())) {
      throw new HttpError("rate_limited", "Give me a minute, then we carry on.");
    }
    return c.json(await onboardingTurn(turns), 200, { "cache-control": "no-store" });
  });
