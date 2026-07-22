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
import { IDLE_SAVE_PROGRESS, SaveProgressDialog, type SaveProgressState } from "@/components/common/SaveProgressDialog";

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
  const [saveProgress, setSaveProgress] = useState<SaveProgressState>(IDLE_SAVE_PROGRESS);

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
    setSaveProgress({ stage: "saving", progress: 0 });

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
        setSaveProgress({ stage: "uploading", progress: 0 });
        const imageUrl = await uploadItemImage(user.uid, targetId, imageFile, (progress) => {
          setSaveProgress({ stage: "uploading", progress });
        });
        setSaveProgress({ stage: "finalizing", progress: 100 });
        await updateItemImageUrl(user.uid, targetId, imageUrl);
      }
      setSaveProgress({ stage: "success", progress: 100 });
      await new Promise((resolve) => setTimeout(resolve, 650));
      router.push(locationId ? `/app/locations/${locationId}` : "/app");
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存に失敗しました。";
      setError(message);
      setSaveProgress({ stage: "error", message });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="アイテムを読み込み中" />;

  const areaMap = new Map(areas.map((area) => [area.id, area.name]));

  return (
    <form onSubmit={handleSubmit} className="ui-form-surface">
      <div className="ui-page-head">
        <h1 className="ui-page-title">{itemId ? "アイテムを編集" : "アイテムを追加"}</h1>
      </div>

      <div className="ui-form-grid mt-7">
        <label className="ui-form-field">
          保管場所 *
          <select required value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            {locations.map((location) => <option key={location.id} value={location.id}>{areaMap.get(location.areaId) ?? "未分類"} / {location.name}</option>)}
          </select>
        </label>
        <label className="ui-form-field">
          アイテム名 *
          <input required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="ui-form-field">
          数量 *
          <input required type="number" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </label>
        <label className="ui-form-field">
          単位
          <input list="unit-options" value={unit} onChange={(event) => setUnit(event.target.value)} />
          <datalist id="unit-options">{UNIT_OPTIONS.map((option) => <option key={option} value={option} />)}</datalist>
        </label>
        <label className="ui-form-field">
          カテゴリ
          <input list="category-options" value={category} onChange={(event) => setCategory(event.target.value)} />
          <datalist id="category-options">{CATEGORY_OPTIONS.map((option) => <option key={option} value={option} />)}</datalist>
        </label>
        <label className="ui-form-field">
          状態メモ
          <input value={statusMemo} onChange={(event) => setStatusMemo(event.target.value)} />
        </label>
      </div>

      <details className="ui-details mt-7" open={Boolean(itemId)}>
        <summary>詳細</summary>
        <div className="ui-form-grid mt-5">
          <label className="ui-form-field">
            期限
            <input type="date" value={expirationDate} onChange={(event) => setExpirationDate(event.target.value)} />
          </label>
          <label className="ui-form-field">
            期限の種類
            <input list="expiration-type-options" value={expirationType} onChange={(event) => setExpirationType(event.target.value)} />
            <datalist id="expiration-type-options">{EXPIRATION_TYPE_OPTIONS.map((option) => <option key={option} value={option} />)}</datalist>
          </label>
          <label className="ui-form-field">
            通知タイミング
            <select value={notifyDaysBefore} onChange={(event) => setNotifyDaysBefore(event.target.value)}>
              <option value="">未設定</option>
              {NOTIFY_DAYS_OPTIONS.map((days) => <option key={days} value={days}>{days}日前</option>)}
            </select>
          </label>
          <label className="ui-form-field">
            低在庫しきい値
            <input type="number" step="0.01" value={lowStockThreshold} onChange={(event) => setLowStockThreshold(event.target.value)} />
          </label>
          <label className="ui-form-field ui-form-field--full">
            メモ
            <textarea value={memo} onChange={(event) => setMemo(event.target.value)} rows={3} />
          </label>
        </div>
      </details>

      <div className="mt-7"><ImagePicker imageUrl={item?.imageUrl} onFileSelect={setImageFile} label="アイテムの写真" disabled={submitting} /></div>

      {error && <p role="alert" className="ui-error mt-7">{error}</p>}

      <div className="ui-form-actions mt-7">
        <button type="button" onClick={() => router.back()} disabled={submitting} className="ui-button ui-button--secondary">戻る</button>
        <button type="submit" disabled={submitting || locations.length === 0} className="ui-button ui-button--primary">
          {locations.length === 0 ? "保管場所を追加" : submitting ? "保存中" : "保存"}
        </button>
      </div>

      <SaveProgressDialog
        state={saveProgress}
        hasImage={Boolean(imageFile)}
        onClose={() => setSaveProgress(IDLE_SAVE_PROGRESS)}
      />
    </form>
  );
}
