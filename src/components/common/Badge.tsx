import type { ReactNode } from "react";

const styles = {
  green: "bg-brand-100 text-brand-700",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  blue: "bg-sky-100 text-sky-700",
  slate: "bg-slate-100 text-slate-700",
};

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: keyof typeof styles }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${styles[tone]}`}>{children}</span>;
}
