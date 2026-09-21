"use client";

import { useState } from "react";
import { recordItemOutcome } from "@/lib/firebase/inventory-outcome";
import { useAuth } from "@/lib/hooks/useAuth";
import { DISCARD_REASONS, canRecordOutcome, outcomeLabel } from "@/lib/inventory/outcome-core";
import type { Item } from "@/lib/types/item";

/**
 * 在庫の「使い切った／捨てた」（Phase 4 手B）。
 *
 * 押すと在庫から消える（2026-09-21 から。以前は数量0で残していた）。レシートから入れた在庫なら、
 * お金管理のレシート明細にも結末と無駄金額が返る（返ったときだけ、いくら無駄だったかを出す）。
 */
export function ItemOutcomeActions({ item }: { item: Item }) {
  const { user } = useAuth();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [done, setDone] = useState("");

  const recorded = outcomeLabel(item.outcome, item.outcomeReason);
  if (recorded) return <p className="ui-item-card__meta">{recorded}</p>;
  if (!canRecordOutcome(item)) return null;

  async function record(choice: Parameters<typeof recordItemOutcome>[2]) {
    if (!user) return;
    setFailure("");
    setBusy(true);
    try {
      const result = await recordItemOutcome(user.uid, item, choice);
      setAsking(false);
      // 何が起きたかを出す。黙って数量が0になるだけだと、お金管理へ返ったのか分からない。
      // 在庫からは消える（2026-09-21 から）。一覧の再描画でカードごと消えるまでの一瞬だけ見える
      setDone(
        result.linesUpdated === 0
          ? "記録して、在庫から消しました。"
          : result.wasteTotal > 0
            ? `在庫から消しました。お金管理のムダ支出に ${result.wasteTotal.toLocaleString("ja-JP")}円 が入ります。`
            : "在庫から消しました。お金管理では無駄なしとして数えます。",
      );
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "記録できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="ui-item-card__meta">{done}</p>;

  return (
    <div className="mt-2">
      {asking ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="ui-item-card__meta">捨てた理由は？</span>
          {DISCARD_REASONS.map((entry) => (
            <button
              key={entry.reason}
              type="button"
              disabled={busy}
              onClick={() => record({ kind: "discarded", reason: entry.reason })}
              className="ui-button ui-button--ghost"
            >
              {entry.reason}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => setAsking(false)} className="ui-button ui-button--ghost">
            やめる
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          <button type="button" disabled={busy} onClick={() => record({ kind: "consumed" })} className="ui-button ui-button--ghost">
            使い切った
          </button>
          <button type="button" disabled={busy} onClick={() => setAsking(true)} className="ui-button ui-button--ghost">
            捨てた
          </button>
        </div>
      )}
      {failure && <p role="alert" className="ui-error">{failure}</p>}
    </div>
  );
}
