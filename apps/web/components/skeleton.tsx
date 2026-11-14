import type { CSSProperties, ReactNode } from "react";

/**
 * Loading states in the final layout of each screen (docs/design-guide.md, "Screens"): the real
 * title, grey bones where the data lands, nothing at all for the first 150ms, then a slow breath.
 * Never a spinner. Reduced motion holds the bones still.
 */
export function Skeleton({ title, label, children }: { title?: string; label: string; children: ReactNode }) {
  return (
    <main className="screen m-skeleton" aria-busy="true" aria-label={label}>
      <header className="pt-2">
        <div className="flex min-h-11 items-center justify-between">
          <Bone className="h-3.5 w-36" />
          <span className="m-bone size-[30px] rounded-full" />
        </div>
        {title ? (
          <h1 className="text-large-title font-bold tracking-[0.01em]">{title}</h1>
        ) : (
          <Bone className="mt-1 h-9 w-32" />
        )}
      </header>
      {children}
    </main>
  );
}

/** One grey shape. Width and height come from utility classes or `style`. */
export function Bone({ className = "", style }: { className?: string; style?: CSSProperties }) {
  const radius = className.includes("rounded-") ? "" : "rounded-block";
  return <span aria-hidden="true" className={`m-bone block ${radius} ${className}`} style={style} />;
}

/** An inset group of rows, as the list it stands in for. */
export function BoneGroup({ rows, rowHeight = 64 }: { rows: number; rowHeight?: number }) {
  return (
    <div aria-hidden="true" className="m-bone overflow-hidden rounded-group">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
        <div key={i} className="relative px-4 py-3" style={{ height: rowHeight }}>
          {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
          <span className="block h-4 w-1/2 rounded-block bg-[color-mix(in_srgb,var(--m-label-2)_18%,transparent)]" />
          <span className="mt-2.5 block h-3 w-3/4 rounded-block bg-[color-mix(in_srgb,var(--m-label-2)_12%,transparent)]" />
        </div>
      ))}
    </div>
  );
}
