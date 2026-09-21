"use client";

import { useState } from "react";
import { deleteItem } from "@/lib/firebase/firestore";
import { useAuth } from "@/lib/hooks/useAuth";
import { outOfStockItems } from "@/lib/inventory/outcome-core";
import type { Item } from "@/lib/types/item";

/**
 * 数量0のまま残っているモノを、まとめて在庫から消す（2026-09-21）。
 *
 * 以前は0になってもモノを残していたので、その頃のモノが残っている。
 * 今は0になった時点で消えるが、もう残っている分は本人が1回押して消す（勝手には消さない）。
 * 0のモノが無くなれば、このカードは出ない。
 */
export function OutOfStockCleanup({ items }: { items: Item[] }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const empty = outOfStockItems(items);
  if (!empty.length) return null;

  async function removeAll() {
    if (!user) return;
    const names = empty.slice(0, 5).map((item) => item.name).join("、");
    const more = empty.length > 5 ? ` ほか${empty.length - 5}件` : "";
    if (!window.confirm(`数量0のモノ ${empty.length}件（${names}${more}）を在庫から消します。よろしいですか？`)) return;
    setFailure("");
    setBusy(true);
    let failed = 0;
    // 1件ずつ消す（公開中の保管場所の表示も合わせるため deleteItem を通す）
    for (const item of empty) {
      try { await deleteItem(user.uid, item.id); } catch { failed += 1; }
    }
    setBusy(false);
    if (failed) setFailure(`${failed}件は消せませんでした。通信を確かめて、もう一度押してください。`);
  }

  return (
    <section className="ui-section" aria-label="数量0のモノ">
      <div className="ui-section__head">
        <h2 className="ui-section__title">数量0のモノが{empty.length}件あります</h2>
        <button type="button" onClick={removeAll} disabled={busy} className="ui-button ui-button--danger">
          {busy ? "消しています" : "まとめて在庫から消す"}
        </button>
      </div>
      <p className="ui-muted">0になったモノは、今は自動で在庫から消えます。前から0のまま残っている分だけ、ここで消してください。</p>
      {failure && <p role="alert" className="ui-error">{failure}</p>}
    </section>
  );
}
