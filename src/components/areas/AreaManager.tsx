"use client";

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
      const input = {
        name,
        sortOrder: sortOrder === "" ? null : Number(sortOrder),
      };
      if (editing) {
        await updateArea(user.uid, editing.id, input);
      } else {
        await createArea(user.uid, input);
      }
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
    <div className="space-y-6">
      <section className="rounded-3xl bg-white p-5 shadow-soft">
        <h1 className="text-xl font-bold text-slate-900">エリア管理</h1>
        <p className="mt-1 text-sm text-slate-500">キッチン、玄関、クローゼットなど家の大きな場所を登録します。</p>
        <form onSubmit={handleSubmit} className="mt-5 grid gap-4 sm:grid-cols-[1fr_120px_auto]">
          <input required value={name} onChange={(event) => setName(event.target.value)} className="rounded-xl border-slate-200" placeholder="例：キッチン" />
          <input type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="rounded-xl border-slate-200" placeholder="並び順" />
          <button disabled={submitting} className="rounded-xl bg-brand-600 px-5 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
            {editing ? "更新" : "追加"}
          </button>
        </form>
        {editing && (
          <button type="button" onClick={() => { setEditing(null); setName(""); setSortOrder(""); }} className="mt-3 text-sm font-semibold text-slate-500">
            編集をキャンセル
          </button>
        )}
        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </section>

      {areas.length === 0 ? (
        <EmptyState title="まだエリアがありません" description="まずは「キッチン」などを登録すると、保管場所を整理しやすくなります。" />
      ) : (
        <div className="grid gap-3">
          {areas.map((area) => (
            <div key={area.id} className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm">
              <div>
                <p className="font-bold text-slate-900">{area.name}</p>
                <p className="text-xs text-slate-500">並び順: {area.sortOrder ?? "未設定"}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEdit(area)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">編集</button>
                <ConfirmDeleteButton onConfirm={() => user ? deleteArea(user.uid, area.id) : undefined} message="このエリアを削除しますか？" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
