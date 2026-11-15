import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import type { ReactNode } from "react";
import { MotionScript } from "@/components/count-up";
import { DeepLinkFocus } from "@/components/deep-link-focus";
import { Desktop } from "@/components/desktop";
import { FocusHost } from "@/components/focus/focus-host";
import { Haptics } from "@/components/haptics";
import { LocationPing } from "@/components/location/location-ping";
import { MeetingPill } from "@/components/meetings";
import { NudgeOpened } from "@/components/nudge-opened";
import { ServiceWorker } from "@/components/service-worker";
import { SessionFresh } from "@/components/session-fresh";
import { Splash } from "@/components/splash";
import { TabBar } from "@/components/tab-bar";
import "./globals.css";

// SF Pro comes from the device. Figtree is only the fallback for devices without it.
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });

export const metadata: Metadata = {
  title: "Michael",
  description: "Michael finds the time you lose every day and gives it back to your goals.",
  applicationName: "Michael",
  appleWebApp: { capable: true, title: "Michael", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The inline motion script marks <html> before hydration (data-counted, data-splashing).
    <html lang="en-GB" className={figtree.variable} suppressHydrationWarning>
      <body>
        <Splash />
        <MotionScript />
        <Haptics />
        <LocationPing />
        <div className="min-h-dvh lg:pl-64">
          <div className="m-content mx-auto w-full max-w-[560px] lg:max-w-none">{children}</div>
        </div>
        <MeetingPill />
        <NudgeOpened />
        <TabBar />
        <FocusHost />
        <ServiceWorker />
        <SessionFresh />
        <Desktop />
        <DeepLinkFocus />
      </body>
    </html>
  );
}
