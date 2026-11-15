import "server-only";
import {
  type AgentClient,
  type ConnectorId,
  isLive,
  type PersonalToken,
  SETUP_KEY_NAMES,
} from "@michael/shared";
import { cookies } from "next/headers";
import { cache } from "react";
import { get, getGoals, getPushConfig } from "./api";
import { isDemoVisitor } from "./caller";
import { CONNECTION_ROUTES } from "./connections";
import { getGoogleCalendar, getTelegram } from "./integrations";
import { USE_MOCKS } from "./mode";
import { saidNoMac } from "./no-mac";

// The first run: what a new person still has to set up, read from their real data. Today shows it
// as the Get started card and picks the empty state's one action from it.

export type SetupKey = "goals" | "calendar" | "watch" | "mac" | "iphone" | "nudges" | "claude";

/** Where each step is done. One map, so the steps can move to the Connections hub in one edit. */
export const SETUP_LINKS: Record<SetupKey, string> = {
  goals: "/onboarding",
  calendar: "/integrations/google/connect",
  watch: CONNECTION_ROUTES["apple-watch"],
  mac: CONNECTION_ROUTES.mac,
  iphone: CONNECTION_ROUTES.iphone,
  nudges: CONNECTION_ROUTES.nudges,
  claude: "/agents",
};

const TITLES: Record<SetupKey, string> = {
  goals: "Set your goals",
  calendar: "Connect Google Calendar",
  watch: "Connect Apple Watch",
  mac: "Connect your Mac",
  iphone: "Connect your iPhone",
  nudges: "Turn on nudges",
  claude: "Connect Claude",
};

const WHY: Record<SetupKey, string> = {
  goals: "Tell me what you're working towards. Five minutes.",
  calendar: "Your planned blocks are what I measure against.",
  watch: "Sleep and workouts, so I know when to push and when to rest.",
  mac: "App time, so I can see where the hours went.",
  iphone: "Which apps you open, and for how long. Live.",
  nudges: "Up to five a day, on your phone and watch.",
  claude: "Ask Claude about your day and let it plan with you.",
};

const CTA: Record<SetupKey, string> = {
  goals: "Set my goals",
  calendar: "Connect calendar",
  watch: "Connect watch",
  mac: "Connect Mac",
  iphone: "Connect iPhone",
  nudges: "Turn on nudges",
  claude: "Connect Claude",
};

const ORDER: SetupKey[] = ["goals", "calendar", "watch", "mac", "nudges", "claude"];

/** The connection behind each step: a step whose connection is Coming soon is left out (#295). */
const CONNECTOR: Partial<Record<SetupKey, ConnectorId>> = {
  calendar: "google-calendar",
  watch: "apple-watch",
  mac: "mac",
  iphone: "iphone",
  nudges: "nudges",
  claude: "claude",
};

const offered = (key: SetupKey) => {
  const id = CONNECTOR[key];
  return id === undefined || isLive(id);
};

/** The device key each connection gets (SETUP_KEY_NAMES in @michael/shared). */
const KEY_NAMES = {
  watch: SETUP_KEY_NAMES["apple-watch"],
  mac: SETUP_KEY_NAMES.mac,
  iphone: SETUP_KEY_NAMES.iphone,
} as const;

export type SetupStep = {
  key: SetupKey;
  title: string;
  why: string;
  cta: string;
  href: string;
  done: boolean;
  /** The Mac step offers "Skip, I don't use a Mac". */
  skippable?: boolean;
};

export type Setup = { steps: SetupStep[]; done: number; next: SetupStep | null };

export const DISMISS_COOKIE = "michael_get_started";

/** A failed read counts as not done: the card then offers the step, which is the safe side. */
const settle = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

/**
 * The signed-in person's setup, or null when there is nothing to set up: sample data, previews and
 * the shared demo account (its devices and calendar are not the visitor's to connect).
 * Cached per request, so the card and the empty state share one round of calls.
 */
export const getSetup = cache(async (demo?: string): Promise<Setup | null> => {
  if (USE_MOCKS || demo) return null;
  if (await isDemoVisitor()) return null;

  const [goals, calendar, tokens, push, agents, telegram, noMac] = await Promise.all([
    settle(getGoals(), []),
    settle(getGoogleCalendar(), null),
    settle(
      get<{ tokens: PersonalToken[] }>("/v1/tokens").then((r) => r.tokens),
      [] as PersonalToken[],
    ),
    settle(getPushConfig(), null),
    settle(
      get<{ agents: AgentClient[] }>("/v1/agents").then((r) => r.agents),
      [] as AgentClient[],
    ),
    settle(getTelegram(), null),
    saidNoMac(),
  ]);

  const hasKey = (name: string) => tokens.some((t) => t.name === name);
  const done: Record<SetupKey, boolean> = {
    goals: goals.some((g) => g.active),
    calendar: calendar?.status === "connected",
    watch: hasKey(KEY_NAMES.watch),
    mac: hasKey(KEY_NAMES.mac),
    iphone: hasKey(KEY_NAMES.iphone),
    nudges: (push?.devices ?? 0) > 0 || telegram?.connected === true,
    claude: agents.some((a) => a.status === "approved"),
  };

  // Without a Mac the app time step is the iPhone's: never a Mac shown as missing progress.
  const withoutMac = !done.mac && (noMac || done.iphone);
  const order = withoutMac ? ORDER.map((k) => (k === "mac" ? "iphone" : k)) : ORDER;
  const steps = order.filter(offered).map((key) => ({
    key,
    title: TITLES[key],
    why: WHY[key],
    cta: CTA[key],
    href: SETUP_LINKS[key],
    done: done[key],
    ...(key === "mac" ? { skippable: true } : {}),
  }));
  return {
    steps,
    done: steps.filter((s) => s.done).length,
    next: steps.find((s) => !s.done) ?? null,
  };
});

/** True once the person hid the card (allowed from 3 steps done). */
export async function getStartedDismissed(): Promise<boolean> {
  return (await cookies()).get(DISMISS_COOKIE)?.value === "1";
}
