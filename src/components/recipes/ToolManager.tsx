"use client";

import Link from "next/link";
import { ArrowLeft, CookingPot, Plus } from "lucide-react";
import { useState } from "react";
import { createTool, deleteTool, updateTool } from "@/lib/firebase/kitchen";
import { useAuth } from "@/lib/hooks/useAuth";
import { useTools } from "@/lib/hooks/useTools";
import { TOOL_FEATURES, TOOL_TYPES } from "@/lib/recipes/suggest-core";
import type { Tool } from "@/lib/types/tool";
import { ConfirmDeleteButton } from "@/components/common/ConfirmDeleteButton";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";

const EMPTY = { name: "", type: "フライパン", sizeLabel: "", features: [] as string[], memo: "" };

/** 調理器具の登録。レシピ提案は、ここに無い器具を使う料理を出さない。 */
export function ToolManager() {
  const { user } = useAuth();
  const { tools, loading, error: loadError } = useTools(user?.uid);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<Tool | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setForm(EMPTY);
    setEditing(null);
  }

  function startEdit(tool: Tool) {
    setEditing(tool);
    setForm({ name: tool.name, type: tool.type, sizeLabel: tool.sizeLabel ?? "", features: tool.features ?? [], memo: tool.memo ?? "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleFeature(feature: string) {
    setForm((current) => ({
      ...current,
      features: current.features.includes(feature) ? current.features.filter((f) => f !== feature) : [...current.features, feature],
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setError("");
    setSubmitting(true);
    try {
      if (editing) await updateTool(user.uid, editing.id, form);
      else await createTool(user.uid, form);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="調理器具を読み込み中" />;
  if (loadError) return <ErrorState error={loadError} title="調理器具を読み込めませんでした。" />;

  return (
    <div className="ui-stack">
      <Link href="/app/recipes" className="ui-button ui-button--ghost self-start"><ArrowLeft size={16} />レシピ提案へ戻る</Link>
      <div className="ui-page-head">
        <div className="flex items-center gap-3"><CookingPot size={25} className="text-[var(--brand)]" /><h1 className="ui-page-title">調理器具</h1></div>
        <span className="ui-section__count">{tools.length}件</span>
      </div>
      <p className="ui-muted">登録した器具だけを使うレシピを提案します。1つも無いときは、コンロ・鍋・フライパン・電子レンジがあるものとして考えます。</p>

      <form onSubmit={handleSubmit} className="ui-form-surface">
        <div className="ui-form-grid">
          <label className="ui-form-field">
            名前 *
            <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例：ティファールのフライパン" />
          </label>
          <label className="ui-form-field">
            種類 *
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              {TOOL_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="ui-form-field">
            大きさ
            <input value={form.sizeLabel} onChange={(event) => setForm({ ...form, sizeLabel: event.target.value })} placeholder="例：26cm、3合" />
          </label>
          <label className="ui-form-field">
            メモ
            <input value={form.memo} onChange={(event) => setForm({ ...form, memo: event.target.value })} />
          </label>
          <fieldset className="ui-form-field ui-form-field--full">
            <legend>特徴</legend>
            <div className="ui-chip-list mt-2">
              {TOOL_FEATURES.map((feature) => (
                <label key={feature} className="ui-check-field">
                  <input type="checkbox" checked={form.features.includes(feature)} onChange={() => toggleFeature(feature)} />
                  {feature}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        {error && <p role="alert" className="ui-error mt-5">{error}</p>}
        <div className="ui-form-actions mt-5">
          {editing && <button type="button" onClick={reset} className="ui-button ui-button--secondary">キャンセル</button>}
          <button type="submit" disabled={submitting} className="ui-button ui-button--primary"><Plus size={17} strokeWidth={2} />{editing ? "更新" : "追加"}</button>
        </div>
      </form>

      {tools.length === 0 ? <EmptyState title="調理器具がまだありません" /> : (
        <div className="ui-list">
          {tools.map((tool) => (
            <div key={tool.id} className="ui-area-row">
              <div className="ui-area-row__meta">
                <p className="ui-area-row__name">{tool.name}</p>
                <p className="ui-area-row__sort">{[tool.type, tool.sizeLabel, ...(tool.features ?? [])].filter(Boolean).join("・")}</p>
              </div>
              <div className="ui-area-row__actions">
                <button type="button" onClick={() => startEdit(tool)} className="ui-button ui-button--secondary">編集</button>
                <ConfirmDeleteButton onConfirm={async () => { if (!user) return; setError(""); await deleteTool(user.uid, tool.id); }} onError={setError} message="この調理器具を削除しますか？" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
