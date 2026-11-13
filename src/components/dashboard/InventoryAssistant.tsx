"use client";

import { Check, RefreshCw, ShoppingCart, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import {
  addToShoppingList, decideSameProduct, readStockEvents, requestInsights, saveInsights, sinceOf, watchInsights, watchProductLinks,
  type SavedInsights,
} from "@/lib/firebase/stock";
import {
  canonicalizer, isInsightStale, japanDay, linkId, nextBuyLabel, nextBuys, productKey,
  type ProductLink, type StockEvent,
} from "@/lib/inventory/stock-core";
import type { Item } from "@/lib/types/item";

/**
 * 在庫AI（2026-11-14 ユーザー要望）。ホームの1か所にまとめて出す。
 * - 次の買い時：使い切った記録から計算（AIに日付を作らせない）
 * - 同じ商品かも：AIが候補を出し、本人が「同じ／別」を決める（意味の判断を自動でやらない）
 * - 栄養：在庫のかたよりと、買うとよいもの（からだの記録も参考にする）
 * AIはホームを開いたとき、前回から1日以上たっていれば考え直す（ユーザー決定）。
 */
export function InventoryAssistant({ items }: { items: Item[] }) {
  const { user } = useAuth();
  const [events, setEvents] = useState<StockEvent[]>([]);
  const [links, setLinks] = useState<ProductLink[]>([]);
  const [insights, setInsights] = useState<SavedInsights | null | undefined>(undefined);
  const [thinking, setThinking] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const asked = useRef(false);
  const uid = user?.uid;
  const itemCount = items.length;

  useEffect(() => {
    if (!uid) return;
    readStockEvents(uid).then(setEvents).catch(() => setEvents([]));
    const stopLinks = watchProductLinks(uid, setLinks);
    const stopInsights = watchInsights(uid, setInsights);
    return () => { stopLinks(); stopInsights(); };
  }, [uid]);

  async function think() {
    if (!user) return;
    setThinking(true);
    setFailure("");
    try {
      const result = await requestInsights(user);
      setInsights(result);
      await saveInsights(user.uid, result);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "在庫AIが考えられませんでした。");
    } finally {
      setThinking(false);
    }
  }

  // ホームを開いたとき、前回から1日以上たっていれば考え直す（1回だけ。失敗しても繰り返さない）
  useEffect(() => {
    if (insights === undefined || asked.current || !uid || !itemCount) return;
    if (!isInsightStale(insights?.generatedAt, Date.now())) return;
    asked.current = true;
    void think();
    // think は毎回作り直されるが、ここでは開いたときの1回だけ動かしたい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insights, uid, itemCount]);

  const today = japanDay(Date.now());
  const plan = useMemo(
    () => nextBuys(items.filter((item) => item.quantity > 0).map((item) => ({ id: item.id, name: item.name, since: sinceOf(item), remainingCheckedAt: item.remainingCheckedAt })), events, links, today),
    [items, events, links, today],
  );
  const canonical = useMemo(() => canonicalizer(links), [links]);
  const decided = useMemo(() => new Set(links.map((link) => linkId(link.a, link.b))), [links]);
  const pairs = (insights?.samePairs ?? []).filter((pair) => {
    const a = productKey(pair.a);
    const b = productKey(pair.b);
    return !decided.has(linkId(a, b)) && canonical(a) !== canonical(b);
  });

  async function decide(a: string, b: string, same: boolean) {
    if (!user) return;
    setBusyKey(`pair:${a}:${b}`);
    try {
      await decideSameProduct(user.uid, a, b, same);
      setNotice(same ? `「${a}」と「${b}」を同じ商品として数えます。` : `「${a}」と「${b}」は別の商品のままにします。`);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "保存できませんでした。");
    } finally {
      setBusyKey("");
    }
  }

  async function toShopping(name: string, reason: string) {
    if (!user) return;
    setBusyKey(`shop:${name}`);
    try {
      const added = await addToShoppingList(user.uid, [name], reason);
      setNotice(added ? `「${name}」をつくりおきノートの買い物リストに入れました。` : `「${name}」はもう買い物リストにあります。`);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "買い物リストに入れられませんでした。");
    } finally {
      setBusyKey("");
    }
  }

  if (!user || (!itemCount && !events.length)) return null;
  const nutrition = insights?.nutrition;
  const shopping = insights?.shopping ?? [];
  const thoughtAt = insights?.generatedAt ? new Date(insights.generatedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  return (
    <section className="ai-panel" aria-labelledby="ai-panel-title" aria-busy={thinking}>
      <div className="ai-panel__head">
        <span className="ai-panel__mark" aria-hidden="true"><Sparkles size={18} strokeWidth={1.9} /></span>
        <h2 id="ai-panel-title" className="ui-section__title">在庫AIから</h2>
        <button type="button" className="ui-button ui-button--ghost ai-panel__again" onClick={think} disabled={thinking} aria-label="在庫AIにもう一度考えてもらう">
          <RefreshCw size={15} strokeWidth={2} className={thinking ? "ai-spin" : undefined} />{thinking ? "考えています" : "考え直す"}
        </button>
      </div>

      <div className="ai-block">
        <h3>次の買い時</h3>
        {plan.length ? (
          <ul className="ai-list">
            {plan.map((entry) => (
              <li key={entry.key} className="ai-row">
                <div className="ai-row__text">
                  <strong>{entry.name}</strong>
                  <span>{nextBuyLabel(entry)}<small>いつもは約{entry.typicalDays}日で使い切り（{entry.cycles}回分）</small></span>
                </div>
                <button type="button" className="ui-button ui-button--ghost" disabled={busyKey === `shop:${entry.name}`} onClick={() => toShopping(entry.name, "在庫AI: 次の買い時")}>
                  <ShoppingCart size={15} strokeWidth={2} />買い物へ
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ai-empty">{events.length ? "7日以内に切れそうなものはありません。" : "「使い切った」「捨てた」「まだ残っている」を押していくと、何日で使い切るかが分かり、次の買い時を出せるようになります。"}</p>
        )}
      </div>

      {pairs.length > 0 && (
        <div className="ai-block">
          <h3>同じ商品ですか？</h3>
          <ul className="ai-list">
            {pairs.map((pair) => (
              <li key={`${pair.a}|${pair.b}`} className="ai-row ai-row--pair">
                <div className="ai-row__text">
                  <strong>「{pair.a}」と「{pair.b}」</strong>
                  {pair.reason && <span>{pair.reason}</span>}
                </div>
                <div className="ai-choice">
                  <button type="button" className="ui-button ui-button--ghost ui-button--used" disabled={busyKey === `pair:${pair.a}:${pair.b}`} onClick={() => decide(pair.a, pair.b, true)}><Check size={15} strokeWidth={2.2} />同じ</button>
                  <button type="button" className="ui-button ui-button--ghost ui-button--tossed" disabled={busyKey === `pair:${pair.a}:${pair.b}`} onClick={() => decide(pair.a, pair.b, false)}><X size={15} strokeWidth={2.2} />別</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {nutrition && (
        <div className="ai-block">
          <h3>栄養のかたより</h3>
          <p className="ai-summary">{nutrition.summary}</p>
          {nutrition.tips.length > 0 && <ul className="ai-tips">{nutrition.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>}
          {shopping.length > 0 && (
            <div className="ai-ideas" aria-label="買うとよいもの">
              {shopping.map((idea) => (
                <button key={idea.name} type="button" className="ui-chip ai-idea" title={idea.reason} disabled={busyKey === `shop:${idea.name}`} onClick={() => toShopping(idea.name, `在庫AI: ${idea.reason || "栄養"}`)}>
                  <ShoppingCart size={14} strokeWidth={2} aria-hidden="true" />{idea.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {notice && <p className="ai-notice" role="status">{notice}</p>}
      {failure && <p className="ui-error" role="alert">{failure}</p>}
      {thoughtAt && (
        <p className="ai-foot">
          {thoughtAt} に{insights?.fallbackModel ? `予備のAI（${insights.fallbackModel}）` : insights?.model || "AI"}で考えました{insights?.usedHealth ? "・からだの記録も参考にしています" : ""}。医療的な指示ではありません。
        </p>
      )}
    </section>
  );
}
