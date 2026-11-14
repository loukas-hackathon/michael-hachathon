"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { formatTime } from "@/lib/format";
import { useOffTheRecord } from "@/lib/off-the-record";
import { MiMark } from "./brand";

/** The Mi button: top right on every tab. Opens the You sheet. Hollow while off the record. */
export function MiButton({ size = 30 }: { size?: number }) {
  const { on } = useOffTheRecord();
  return (
    <Link
      href="/you"
      aria-label={on ? "You, off the record" : "You"}
      className="press grid shrink-0 place-items-center rounded-full"
      style={{
        width: Math.max(size, 44),
        height: Math.max(size, 44),
        margin: size < 44 ? -(44 - size) / 2 : 0,
      }}
    >
      <span
        className={`grid place-items-center rounded-full ${
          on ? "text-label shadow-[inset_0_0_0_1.5px_var(--m-label)]" : "bg-label text-bg"
        }`}
        style={{ width: size, height: size }}
      >
        <span style={{ width: Math.round(size * 0.56) }} className="block">
          <MiMark className="block h-auto w-full" />
        </span>
      </span>
    </Link>
  );
}

/** The grey line every tab shows while collection is stopped. */
export function OffTheRecordLine() {
  const { on, since } = useOffTheRecord();
  if (!on) return null;
  return (
    <p className="mt-2 rounded-group bg-fill px-3 py-2 text-footnote text-label-2 tnum">
      Off the record{since ? ` since ${formatTime(since)}` : ""}. Nothing is being collected.
    </p>
  );
}

/** Context line + Mi button, then the large title, as in Apple's own apps. */
export function ScreenHeader({ context, title }: { context: ReactNode; title: string }) {
  return (
    <header className="pt-2">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <p className="text-footnote font-semibold text-label-2 tnum">{context}</p>
        <MiButton />
      </div>
      <h1 className="text-large-title font-bold tracking-[0.01em]">{title}</h1>
      <OffTheRecordLine />
    </header>
  );
}
