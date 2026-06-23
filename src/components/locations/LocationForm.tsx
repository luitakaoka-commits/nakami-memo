"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createLocation, getLocation, updateLocation, updateLocationImageUrl } from "@/lib/firebase/firestore";
import { uploadLocationImage } from "@/lib/firebase/storage";
import { useAreas } from "@/lib/hooks/useAreas";
import { useAuth } from "@/lib/hooks/useAuth";
import type { Location } from "@/lib/types/location";
import { LOCATION_TYPE_OPTIONS } from "@/lib/types/location";
import { ImagePicker } from "@/components/common/ImagePicker";
import { LoadingState } from "@/components/common/LoadingState";

export function LocationForm({ locationId }: { locationId?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { areas } = useAreas(user?.uid);
  const [location, setLocation] = useState<Location | null>(null);
  const [areaId, setAreaId] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [memo, setMemo] = useState("");
  const [labelName, setLabelName] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(Boolean(locationId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || !locationId) return;
    async function load() {
      if (!user || !locationId) return;
      const result = await getLocation(user.uid, locationId);
      if (!result) {
        setError("保管場所が見つかりません。");
        setLoading(false);
        return;
      }
      setLocation(result);
      setAreaId(result.areaId);
      setName(result.name);
      setType(result.type ?? "");
      setMemo(result.memo ?? "");
      setLabelName(result.labelName ?? "");
      setSortOrder(result.sortOrder?.toString() ?? "");
      setIsPublic(result.isPublic);
      setLoading(false);
    }
    load();
  }, [locationId, user]);

  useEffect(() => {
    if (!areaId && areas[0]) setAreaId(areas[0].id);
  }, [areaId, areas]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setError("");
    setSubmitting(true);

    try {
      const input = {
        areaId,
        name,
        type,
        memo,
        labelName,
        sortOrder: sortOrder === "" ? null : Number(sortOrder),
        isPublic,
      };
      const ref = locationId ? null : await createLocation(user.uid, input);
      const targetId = locationId ?? ref?.id;
      if (locationId) await updateLocation(user.uid, locationId, input);
      if (targetId && imageFile) {
        const imageUrl = await uploadLocationImage(user.uid, targetId, imageFile);
        await updateLocationImageUrl(user.uid, targetId, imageUrl);
      }
      router.push(targetId ? `/app/locations/${targetId}` : "/app/locations");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="保管場所を読み込み中" />;

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-3xl bg-white p-5 shadow-soft">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{locationId ? "保管場所を編集" : "保管場所を追加"}</h1>
        <p className="mt-1 text-sm text-slate-500">基本項目だけ入れればOK。細かいことはあとで盛れます。</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          エリア *
          <select required value={areaId} onChange={(event) => setAreaId(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200">
            {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          保管場所名 *
          <input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" placeholder="例：冷蔵庫" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          種類
          <input list="location-types" value={type} onChange={(event) => setType(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" placeholder="未設定でもOK" />
          <datalist id="location-types">{LOCATION_TYPE_OPTIONS.map((option) => <option key={option} value={option} />)}</datalist>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          ラベル名
          <input value={labelName} onChange={(event) => setLabelName(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" placeholder="QRラベルに表示" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          並び順
          <input type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" placeholder="未設定なら名前順" />
        </label>
        <label className="mt-7 flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} className="rounded border-slate-300 text-brand-600" />
          公開閲覧をONにする
        </label>
      </div>

      <label className="block text-sm font-medium text-slate-700">
        メモ
        <textarea value={memo} onChange={(event) => setMemo(event.target.value)} className="mt-1 w-full rounded-xl border-slate-200" rows={3} placeholder="例：上段は飲み物、下段は作り置き" />
      </label>

      <ImagePicker imageUrl={location?.imageUrl} onFileSelect={setImageFile} label="保管場所の写真（1枚）" />

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button disabled={submitting || areas.length === 0} className="w-full rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {areas.length === 0 ? "先にエリアを作成してください" : submitting ? "保存中" : "保存"}
      </button>
    </form>
  );
}
