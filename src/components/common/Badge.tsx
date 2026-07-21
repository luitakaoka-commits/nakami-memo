import type { ReactNode } from "react";

const tones = {
  green: "ui-badge--green",
  amber: "ui-badge--amber",
  red: "ui-badge--red",
  blue: "ui-badge--blue",
  slate: "ui-badge--slate",
};

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: keyof typeof tones }) {
  return <span className={`ui-badge ${tones[tone]}`}>{children}</span>;
}

