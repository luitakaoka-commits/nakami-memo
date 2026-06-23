"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createItem, getItem, updateItem, updateItemImageUrl } from "@/lib/firebase/firestore";
import { uploadItemImage } from "@/lib/firebase/storage";
import { useAreas } from "@/lib/hooks/useAreas";
import { useAuth } from "@/lib/hooks/useAuth";
import { useLocations } from "@/lib/hooks/useLocations";
import { CATEGORY_OPTIONS, EXPIRATION_TYPE_OPTIONS, NOTIFY_DAYS_OPTIONS, UNIT_OPTIONS, type Item } from "@/lib/types/item";
import { toDateInputValue } from "@/lib/utils/dates";
import { ImagePicker } from "@/components/common/ImagePicker";
import { LoadingState } from "@/components/common/LoadingState";

export function ItemForm({ itemId }: { itemId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedLocationId = searchParams.get("locationId") ?? "";
  const { user } = useAuth();
  const { areas } = useAreas(user?.uid);
  const { locations } = useLocations(user?.uid);
  const [item, setItem] = useState<Item | null>(null);
  const [locationId, setLocationId] = useState(requestedLocationId);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [statusMemo, setStatusMemo] = useState("");
  const [category, setCategory] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [expirationType, setExpirationType] = useState("");
  const [notifyDaysBefore, setNotifyDaysBefore] = useState("");
  const [memo, setMemo] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(Boolean(itemId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || !itemId) return;
    async function load() {
      if (!user || !itemId) return;
      const result = await getItem(user.uid, itemId);
      if (!result) {
        setError("アイテムが見つかりません。");
        setLoading(false);
        return;
      }
      setItem(result);
      setLocationId(result.locationId);
      setName(result.name);
      setQuantity(result.quantity.toString());
      setUnit(result.unit ?? "");
      setStatusMemo(result.statusMemo ?? "");
      setCategory(result.category ?? "");
      setExpirationDate(toDateInputValue(result.expirationDate));
      setExpirationType(result.expirationType ?? "");
      setNotifyDaysBefore(result.notifyDaysBefore?.toString() ?? "");
      setMemo(result.memo ?? "");
      setLowStockThreshold(result.lowStockThreshold?.toString() ?? "");
      setLoading(false);
    }
    load();
  }, [itemId, user]);

  useEffect(() => {
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [locationId, locations]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setError("");
    setSubmitting(true);

    try {
      const input = {
        locationId,
        name,
        quantity: Number(quantity),
        unit,
        statusMemo,
        category,
        expirationDate: expirationDate ? new Date(`${expirationDate}T00:00:00`) : null,
        expirationType,
        notifyDaysBefore: notifyDaysBefore === "" ? null : Number(notifyDaysBefore),
        memo,
        lowStockThreshold: lowStockThreshold === "" ? null : Number(lowStockThreshold),
      };
      const ref = itemId ? null : await createItem(user.uid, input);
      const targetId = itemId ?? ref?.id;
      if (itemId) await updateItem(user.uid, itemId, input);
      if (targetId && imageFile) {
        const imageUrl = await uploadItemImage(user.uid, targetId, imageFile);
        await updateItemImageUrl(user.uid, targetId, imageUrl);
      }
      router.push(locationId ? `/app/locations/${locationId}` : "/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="アイテムを読み込み中" />;

  const areaMap = new Map(areas.map((area) => [area.id, area.name]));

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-3xl bg-white p-5 shadow-soft">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{itemId ? "アイテムを編集" : "アイテムを追加"}</h1>
        <p className="mt-1 text-sm text-slate-500">数量は数値、状態はメモ。ここを分けるのがミソです。</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          保管場所 *
          <select required value={locationId} onChange={(event) => setLocationId(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200">
            {locations.map((location) => <option key={location.id} value={location.id}>{areaMap.get(location.areaId) ?? "未分類"} / {location.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          アイテム名 *
          <input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" placeholder="例：牛乳" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          数量 *
          <input required type="number" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          単位
          <input list="unit-options" value={unit} onChange={(event) => setUnit(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" placeholder="例：本" />
          <datalist id="unit-options">{UNIT_OPTIONS.map((option) => <option key={option} value={option} />)}</datalist>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          カテゴリ
          <input list="category-options" value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" placeholder="例：食品" />
          <datalist id="category-options">{CATEGORY_OPTIONS.map((option) => <option key={option} value={option} />)}</datalist>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          状態メモ
          <input value={statusMemo} onChange={(event) => setStatusMemo(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" placeholder="例：開封済み" />
        </label>
      </div>

      <details className="rounded-2xl bg-slate-50 p-4" open={Boolean(itemId)}>
        <summary className="cursor-pointer font-bold text-slate-700">詳細項目</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            期限
            <input type="date" value={expirationDate} onChange={(event) => setExpirationDate(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            期限の種類
            <input list="expiration-type-options" value={expirationType} onChange={(event) => setExpirationType(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" placeholder="例：賞味期限" />
            <datalist id="expiration-type-options">{EXPIRATION_TYPE_OPTIONS.map((option) => <option key={option} value={option} />)}</datalist>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            通知タイミング
            <select value={notifyDaysBefore} onChange={(event) => setNotifyDaysBefore(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200">
              <option value="">未設定</option>
              {NOTIFY_DAYS_OPTIONS.map((days) => <option key={days} value={days}>{days}日前</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            低在庫しきい値
            <input type="number" step="0.01" value={lowStockThreshold} onChange={(event) => setLowStockThreshold(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" placeholder="例：2" />
          </label>
          <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
            メモ
            <textarea value={memo} onChange={(event) => setMemo(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" rows={3} placeholder="公開画面には出ません" />
          </label>
        </div>
      </details>

      <ImagePicker imageUrl={item?.imageUrl} onFileSelect={setImageFile} label="アイテムの写真（1枚）" />

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button disabled={submitting || locations.length === 0} className="w-full rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {locations.length === 0 ? "先に保管場所を作成してください" : submitting ? "保存中" : "保存"}
      </button>
    </form>
  );
}
