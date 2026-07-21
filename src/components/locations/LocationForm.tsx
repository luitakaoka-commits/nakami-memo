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
    <form onSubmit={handleSubmit} className="ui-form-surface">
      <div className="ui-page-head">
        <h1 className="ui-page-title">{locationId ? "保管場所を編集" : "保管場所を追加"}</h1>
      </div>

      <div className="ui-form-grid mt-7">
        <label className="ui-form-field">
          エリア *
          <select required value={areaId} onChange={(event) => setAreaId(event.target.value)}>
            {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
        </label>
        <label className="ui-form-field">
          保管場所名 *
          <input required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="ui-form-field">
          種類
          <input list="location-types" value={type} onChange={(event) => setType(event.target.value)} />
          <datalist id="location-types">{LOCATION_TYPE_OPTIONS.map((option) => <option key={option} value={option} />)}</datalist>
        </label>
        <label className="ui-form-field">
          ラベル名
          <input value={labelName} onChange={(event) => setLabelName(event.target.value)} />
        </label>
        <label className="ui-form-field">
          並び順
          <input type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
        </label>
        <label className="ui-check-field">
          <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
          公開閲覧
        </label>
        <label className="ui-form-field ui-form-field--full">
          メモ
          <textarea value={memo} onChange={(event) => setMemo(event.target.value)} rows={3} />
        </label>
      </div>

      <div className="mt-7"><ImagePicker imageUrl={location?.imageUrl} onFileSelect={setImageFile} label="保管場所の写真" /></div>

      {error && <p role="alert" className="ui-error mt-7">{error}</p>}

      <div className="ui-form-actions mt-7">
        <button type="button" onClick={() => router.back()} className="ui-button ui-button--secondary">戻る</button>
        <button type="submit" disabled={submitting || areas.length === 0} className="ui-button ui-button--primary">
          {areas.length === 0 ? "エリアを追加" : submitting ? "保存中" : "保存"}
        </button>
      </div>
    </form>
  );
}

