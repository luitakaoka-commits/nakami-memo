import type { ReactNode } from "react";

// 呼び出し側は旧来の色名のまま。表示は状態チップ（.ui-status）の意味色3つだけに写す（2026-11 UI 統一 TASK4）
// 正常・中立（green / blue / slate）→ income、注意（amber）→ warning、危険（red）→ danger
const tones = {
  green: "ui-status--income",
  amber: "ui-status--warning",
  red: "ui-status--danger",
  blue: "ui-status--income",
  slate: "ui-status--income",
};

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: keyof typeof tones }) {
  return <span className={`ui-status ${tones[tone]}`}>{children}</span>;
}
