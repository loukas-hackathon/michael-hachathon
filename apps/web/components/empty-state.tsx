import type { ReactNode } from "react";

/** Says what will appear here and gives one next action. Never "No data yet". */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="mt-8 flex flex-col gap-2 rounded-card bg-fill px-4 pt-4 pb-5">
      <h2 className="text-title3 font-bold">{title}</h2>
      <p className="max-w-[46ch] text-subhead text-label-2">{children}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}
