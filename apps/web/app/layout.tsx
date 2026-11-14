import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import type { ReactNode } from "react";
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
    <html lang="en-GB" className={figtree.variable}>
      <body>
        <div className="min-h-dvh lg:pl-64">
          <div className="mx-auto w-full max-w-[560px] lg:max-w-[720px]">{children}</div>
        </div>
        <TabBar />
      </body>
    </html>
  );
}
