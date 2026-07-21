"use client";

import { Layers3, Plus } from "lucide-react";
import { useState } from "react";
import { createArea, deleteArea, updateArea } from "@/lib/firebase/firestore";
import { useAreas } from "@/lib/hooks/useAreas";
import { useAuth } from "@/lib/hooks/useAuth";
import type { Area } from "@/lib/types/area";
import { ConfirmDeleteButton } from "@/components/common/ConfirmDeleteButton";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";

export function AreaManager() {
  const { user } = useAuth();
  const { areas, loading } = useAreas(user?.uid);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [editing, setEditing] = useState<Area | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setError("");
    setSubmitting(true);
    try {
      const input = { name, sortOrder: sortOrder === "" ? null : Number(sortOrder) };
      if (editing) await updateArea(user.uid, editing.id, input);
      else await createArea(user.uid, input);
      setName("");
      setSortOrder("");
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(area: Area) {
    setEditing(area);
    setName(area.name);
    setSortOrder(area.sortOrder?.toString() ?? "");
  }

  if (loading) return <LoadingState label="エリアを読み込み中" />;

  return (
    <div className="ui-stack">
      <div className="ui-page-head"><div className="flex items-center gap-3"><Layers3 size={25} className="text-[var(--brand)]" /><h1 className="ui-page-title">エリア管理</h1></div><span className="ui-section__count">{areas.length}件</span></div>

      <section className="ui-form-surface">
        <form onSubmit={handleSubmit} className="ui-inline-form">
          <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="エリア名" aria-label="エリア名" />
          <input type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} placeholder="並び順" aria-label="並び順" />
          <button type="submit" disabled={submitting} className="ui-button ui-button--primary"><Plus size={17} strokeWidth={2} />{editing ? "更新" : "追加"}</button>
        </form>
        {editing && <button type="button" onClick={() => { setEditing(null); setName(""); setSortOrder(""); }} className="ui-button ui-button--ghost mt-3">キャンセル</button>}
        {error && <p role="alert" className="ui-error mt-3">{error}</p>}
      </section>

      {areas.length === 0 ? <EmptyState title="エリアがありません" /> : (
        <div className="ui-list">
          {areas.map((area) => (
            <div key={area.id} className="ui-area-row">
              <div className="ui-area-row__meta"><p className="ui-area-row__name">{area.name}</p><p className="ui-area-row__sort">並び順: {area.sortOrder ?? "未設定"}</p></div>
              <div className="ui-area-row__actions"><button type="button" onClick={() => startEdit(area)} className="ui-button ui-button--secondary">編集</button><ConfirmDeleteButton onConfirm={() => user ? deleteArea(user.uid, area.id) : undefined} message="このエリアを削除しますか？" /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

