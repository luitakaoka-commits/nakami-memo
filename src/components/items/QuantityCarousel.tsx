"use client";

import { Check, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { updateItemQuantity } from "@/lib/firebase/firestore";
import { useAuth } from "@/lib/hooks/useAuth";
import { formatQuantity, quantityChoices } from "@/lib/inventory/quantity-core";
import type { Item } from "@/lib/types/item";

/** 指を離してから保存するまでの間（続けて回しているあいだは保存しない） */
const SAVE_DELAY_MS = 700;

/**
 * 一覧から数量を変えるカルーセル（2026-11-14 ユーザー要望「編集画面に行かなくても変えたい」）。
 * 横に流すと、まんなかに止まった数が選ばれ、少し待つと保存される。数字を押しても、−／＋でも選べる。
 * 0 は出さない（0 は在庫から消えるので「使い切った／捨てた」から。使い切るまでの日数やムダ支出がそちらで残る）。
 */
export function QuantityCarousel({ item, onClose }: { item: Item; onClose: () => void }) {
  const { user } = useAuth();
  // 開いた時点の数で並びを決める（保存のたびに並びが変わって、指の下の数がずれないように）
  const [choices] = useState(() => quantityChoices(item.quantity, item.unit));
  const [selected, setSelected] = useState(item.quantity);
  const [saved, setSaved] = useState(item.quantity);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const track = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);

  const center = useCallback((value: number, smooth: boolean) => {
    const box = track.current;
    const option = box?.querySelector<HTMLButtonElement>(`[data-value="${value}"]`);
    if (!box || !option) return;
    const left = option.offsetLeft + option.offsetWidth / 2 - box.clientWidth / 2;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ left, behavior: smooth && !reduce ? "smooth" : "auto" });
  }, []);

  // 開いたときだけ、いまの数をまんなかに（保存で数が変わっても、回している途中の位置は動かさない）
  const opened = useRef(item.quantity);
  useEffect(() => { center(opened.current, false); }, [center]);

  const save = useCallback(async (value: number) => {
    if (!user) return;
    pending.current = null;
    setStatus("saving");
    setError("");
    try {
      await updateItemQuantity(user.uid, item, value);
      setSaved(value);
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "数量を保存できませんでした。");
    }
  }, [item, user]);

  // 選んだ数が変わったら、少し待ってから保存（回している途中では保存しない）
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (selected === saved) { pending.current = null; return; }
    pending.current = selected;
    setStatus("idle");
    saveTimer.current = setTimeout(() => void save(selected), SAVE_DELAY_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [selected, saved, save]);

  // 閉じる前に、まだ保存していない数があれば保存する。
  // 数をもう一度押して閉じたとき（この部品が消えるとき）も同じ。消える前に最新の save を使えるよう ref に置く
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => () => {
    if (pending.current !== null) void saveRef.current(pending.current);
  }, []);

  function close() {
    onClose();
  }

  // 流し終わったところで、まんなかにいちばん近い数を選ぶ
  function onScroll() {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const box = track.current;
      if (!box) return;
      const middle = box.scrollLeft + box.clientWidth / 2;
      let best = selected;
      let distance = Infinity;
      box.querySelectorAll<HTMLButtonElement>("[data-value]").forEach((option) => {
        const gap = Math.abs(option.offsetLeft + option.offsetWidth / 2 - middle);
        if (gap < distance) { distance = gap; best = Number(option.dataset.value); }
      });
      setSelected(best);
    }, 90);
  }

  function pick(value: number) {
    setSelected(value);
    center(value, true);
  }

  function move(delta: number) {
    const index = choices.indexOf(selected);
    const next = choices[Math.min(choices.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta))];
    if (next !== undefined) pick(next);
  }

  const index = choices.indexOf(selected);
  return (
    <div className="qty-carousel" role="group" aria-label={`${item.name}の数量`}>
      <button type="button" className="qty-step" onClick={() => move(-1)} disabled={index <= 0} aria-label="1つ減らす"><Minus size={18} strokeWidth={2.2} /></button>
      <div
        ref={track}
        className="qty-track"
        onScroll={onScroll}
        tabIndex={0}
        aria-label="横に流して数を選ぶ"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
          if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
        }}
      >
        {choices.map((value) => (
          <button
            key={value}
            type="button"
            data-value={value}
            className="qty-option"
            aria-pressed={value === selected}
            aria-label={`${formatQuantity(value)}${item.unit ?? ""}`}
            onClick={() => pick(value)}
            tabIndex={-1}
          >
            {formatQuantity(value)}
          </button>
        ))}
      </div>
      <button type="button" className="qty-step" onClick={() => move(1)} disabled={index >= choices.length - 1} aria-label="1つ増やす"><Plus size={18} strokeWidth={2.2} /></button>
      <div className="qty-foot">
        <span role="status" className={`qty-status qty-status--${status}`}>
          {status === "saving" ? "保存しています" : status === "saved" ? <><Check size={14} strokeWidth={2.4} aria-hidden="true" />{formatQuantity(saved)}{item.unit ?? ""}にしました</> : status === "error" ? error : "0は「使い切った」「捨てた」から"}
        </span>
        <button type="button" className="ui-button ui-button--ghost qty-done" onClick={close}>完了</button>
      </div>
    </div>
  );
}
