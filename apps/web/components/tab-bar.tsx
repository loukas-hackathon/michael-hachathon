"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ComponentType, useEffect, useRef } from "react";
import { useCheckIn } from "@/lib/check-in";
import { Wordmark } from "./brand";
import { ChatIcon, GoalsIcon, TimelineIcon, TodayIcon } from "./icons";

const TABS: { href: string; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { href: "/", label: "Today", Icon: TodayIcon },
  { href: "/timeline", label: "Timeline", Icon: TimelineIcon },
  { href: "/goals", label: "Goals", Icon: GoalsIcon },
  { href: "/chat", label: "Chat", Icon: ChatIcon },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Fire on window to make every cached tab refresh on its next visit. */
export const TABS_STALE = "michael:tabs-stale";

// A tab shown from the client cache older than this is refreshed behind the cached screen.
const REFRESH_AFTER_MS = 30_000;
// How long a tab must stay open before that background refresh starts.
const SETTLE_MS = 1_000;

/**
 * Instant tabs: every tab is prefetched in full (Link prefetch) and kept in the client cache
 * (experimental.staleTimes in next.config.ts), so a tap paints the cached screen at once. When
 * that copy is older than REFRESH_AFTER_MS, the screen refreshes in the background, keeping what
 * is on screen until the new data lands.
 */
function useFreshTabs(pathname: string) {
  const router = useRouter();
  const fetchedAt = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    const now = Date.now();
    // Prefetches start as the bar mounts, so that is when every tab was last fetched.
    fetchedAt.current ??= Object.fromEntries(TABS.map((t) => [t.href, now]));
    const tab = TABS.find((t) => isActive(pathname, t.href))?.href;
    if (!tab) return;
    const last = fetchedAt.current[tab] ?? now;
    if (now - last <= REFRESH_AFTER_MS) return;
    // Wait until the person settles on the tab: a refresh drops the cached copies of the other
    // tabs too, so one fired while tapping through would make the next tap wait on the server.
    const t = setTimeout(() => {
      // The refresh also re-prefetches every tab, so they are all fresh again.
      const at = Date.now();
      fetchedAt.current = Object.fromEntries(TABS.map((x) => [x.href, at]));
      router.refresh();
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [pathname, router]);
  // Something changed the day outside a server action (Michael acted from chat): every cached
  // tab refreshes on its next visit.
  useEffect(() => {
    const stale = () => {
      if (fetchedAt.current) for (const k of Object.keys(fetchedAt.current)) fetchedAt.current[k] = 0;
    };
    window.addEventListener(TABS_STALE, stale);
    return () => window.removeEventListener(TABS_STALE, stale);
  }, []);
}

/**
 * Phone: a floating capsule at the bottom, the one place blur is allowed (as on iOS).
 * Desktop: a sidebar with the wordmark. The bar never moves or hides.
 */
export function TabBar() {
  const pathname = usePathname();
  // A quiet dot on Chat while Michael's check in waits: no number, no red.
  const waiting = !useCheckIn().done;
  useFreshTabs(pathname);
  if (["/onboarding", "/connect", "/stage", "/setup"].some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      aria-label="Michael"
      style={{ viewTransitionName: "tabbar" }}
      className="fixed inset-x-[14px] bottom-[calc(16px+env(safe-area-inset-bottom))] z-20 h-[var(--m-tabbar-h)] rounded-full bg-[var(--m-glass)] shadow-[0_0_0_0.5px_var(--m-separator),0_6px_18px_-8px_rgb(0_0_0/0.25)] backdrop-blur-xl backdrop-saturate-150 lg:inset-x-auto lg:top-0 lg:bottom-0 lg:left-0 lg:h-auto lg:w-64 lg:rounded-none lg:bg-bg lg:shadow-[0.5px_0_0_var(--m-separator)] lg:backdrop-blur-none"
    >
      <div className="hidden px-6 pt-8 pb-6 lg:block">
        <Wordmark className="h-6 w-auto text-label" />
      </div>
      <ul className="grid h-full grid-cols-4 items-center px-1.5 lg:flex lg:h-auto lg:flex-col lg:items-stretch lg:gap-1 lg:px-3">
        {TABS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="h-full lg:h-auto">
              <Link
                href={href}
                prefetch
                aria-current={active ? "page" : undefined}
                className={`m-tab flex h-full flex-col items-center justify-center gap-px text-tab font-semibold lg:h-11 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-block lg:px-3 lg:text-body ${
                  active ? "text-tint-text lg:bg-fill" : "text-label"
                }`}
              >
                <span className="relative">
                  <Icon className="m-tab-icon size-6" />
                  {href === "/chat" && waiting && !active ? (
                    <span
                      role="img"
                      aria-label="Questions waiting"
                      className="absolute -top-0.5 -right-1 size-2 rounded-full bg-label ring-2 ring-[var(--m-bg)]"
                    />
                  ) : null}
                </span>
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
