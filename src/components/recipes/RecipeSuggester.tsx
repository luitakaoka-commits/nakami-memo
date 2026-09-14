"use client";

import Link from "next/link";
import { BookmarkPlus, ChefHat, Check, CookingPot, LoaderCircle, Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { recordCooking, saveRecipeToTsukurioki, type CookedRow } from "@/lib/firebase/kitchen";
import { useAuth } from "@/lib/hooks/useAuth";
import { useInventory } from "@/lib/hooks/useInventory";
import { useTools } from "@/lib/hooks/useTools";
import { requestSuggestions, type SuggestResponse } from "@/lib/recipes/client";
import {
  defaultConsumption,
  defaultMustUseIds,
  pickPantry,
  toTsukuriokiRecipe,
  type RecipeSuggestion,
} from "@/lib/recipes/suggest-core";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";

const SERVINGS = [1, 2, 3, 4, 5, 6];
const MINUTES = [15, 30, 45, 60];

function expiryLabel(days: number | null) {
  if (days === null) return "";
  if (days < 0) return "期限切れ";
  if (days === 0) return "今日まで";
  return `あと${days}日`;
}

/**
 * レシピ提案の画面。期限が近い食材を必ず使うレシピを AI に3つ考えてもらい、
 * つくりおきノートに保存したり、「作った」で在庫を減らしたりする。
 */
export function RecipeSuggester() {
  const { user } = useAuth();
  const { items, loading, error: loadError } = useInventory();
  const { tools } = useTools(user?.uid);

  // 在庫は画面を開いている間も変わるので、提案に使う形は毎回ここで作る（API もサーバー側で同じ関数を使う）
  const pantry = useMemo(
    () => pickPantry(items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      category: item.category,
      expirationMillis: item.expirationDate ? item.expirationDate.toMillis() : null,
    })), Date.now()),
    [items],
  );
  const choosable = pantry.filter((item) => item.category !== "調味料" && (item.expiresInDays === null || item.expiresInDays >= 0));

  const [servings, setServings] = useState(2);
  const [maxMinutes, setMaxMinutes] = useState(30);
  const [mustUse, setMustUse] = useState<string[] | null>(null); // null = まだ触っていない（期限が近いものを選んだ状態）
  const [exclude, setExclude] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SuggestResponse | null>(null);

  const selected = mustUse ?? defaultMustUseIds(pantry);

  function toggle(id: string) {
    setMustUse(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  async function ask() {
    if (!user) return;
    setError("");
    setAsking(true);
    setResult(null);
    try {
      const response = await requestSuggestions(user, {
        servings,
        maxMinutes,
        mustUseItemIds: selected,
        excludeIngredients: exclude.split(/[、,\s]+/).map((s) => s.trim()).filter(Boolean),
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "レシピを提案できませんでした。");
    } finally {
      setAsking(false);
    }
  }

  if (loading) return <LoadingState label="在庫を読み込み中" />;
  if (loadError) return <ErrorState error={loadError} title="在庫を読み込めませんでした。" />;

  return (
    <div className="ui-stack">
      <div className="ui-page-head">
        <div className="flex items-center gap-3"><ChefHat size={25} className="text-[var(--brand)]" /><h1 className="ui-page-title">レシピ提案</h1></div>
        <Link href="/app/tools" className="ui-button ui-button--secondary"><CookingPot size={16} />調理器具 {tools.length}件</Link>
      </div>
      <p className="ui-muted">期限が近い食材を必ず使うレシピを、AIが3つ考えます。登録した調理器具で作れるものだけを出します。</p>
      <p className="ui-muted">牛乳や小麦粉のように少しずつ使うものは、在庫の単位を <strong>mL</strong> や <strong>g</strong> にしておくと、「作った」で使った分だけ正確に減らせます（「1本」のままだと、減らす量を自分で入れることになります）。</p>

      {pantry.length === 0 ? (
        <EmptyState title="使える食材がありません。カテゴリを「食品」「飲料」「調味料」にした在庫を登録してください" actionLabel="在庫を追加" href="/app/items/new" />
      ) : (
        <section className="ui-form-surface">
          <div className="ui-form-grid">
            <label className="ui-form-field">
              何人分
              <select value={servings} onChange={(event) => setServings(Number(event.target.value))}>
                {SERVINGS.map((n) => <option key={n} value={n}>{n}人分</option>)}
              </select>
            </label>
            <label className="ui-form-field">
              調理時間
              <select value={maxMinutes} onChange={(event) => setMaxMinutes(Number(event.target.value))}>
                {MINUTES.map((n) => <option key={n} value={n}>{n}分以内</option>)}
              </select>
            </label>
            <fieldset className="ui-form-field ui-form-field--full">
              <legend>必ず使う食材（期限が近いものに最初から印が付いています）</legend>
              <div className="ui-chip-list mt-2">
                {choosable.map((item) => (
                  <label key={item.id} className="ui-check-field">
                    <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
                    {item.name}
                    {item.expiresInDays !== null && item.expiresInDays <= 3 && <span className="ui-badge ui-badge--amber">{expiryLabel(item.expiresInDays)}</span>}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="ui-form-field ui-form-field--full">
              使わない食材
              <input value={exclude} onChange={(event) => setExclude(event.target.value)} placeholder="例：ピーマン、セロリ" />
            </label>
          </div>
          {tools.length === 0 && <p className="ui-form-note mt-5">調理器具が未登録なので、コンロ・鍋・フライパン・電子レンジがあるものとして考えます。</p>}
          {error && <p role="alert" className="ui-error mt-5">{error}</p>}
          <div className="ui-form-actions mt-5">
            <button type="button" onClick={ask} disabled={asking} className="ui-button ui-button--primary">
              {asking ? <LoaderCircle size={17} className="animate-spin" /> : <Sparkles size={17} />}
              {asking ? "考えています（30秒ほど）" : "レシピを考えてもらう"}
            </button>
          </div>
        </section>
      )}

      {result && (
        <div className="ui-stack">
          {result.uncoveredMustUse.length > 0 && (
            <p className="ui-status-note"><TriangleAlert size={16} className="inline mr-1" />{result.uncoveredMustUse.join("、")}を使うレシピは作れませんでした。条件を変えてもう一度お試しください。</p>
          )}
          {result.recipes.map((recipe, index) => (
            <SuggestionCard key={`${recipe.title}-${index}`} recipe={recipe} pantryItems={items} toolNames={tools} />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ recipe, pantryItems, toolNames }: {
  recipe: RecipeSuggestion;
  pantryItems: ReturnType<typeof useInventory>["items"];
  toolNames: ReturnType<typeof useTools>["tools"];
}) {
  const { user } = useAuth();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cooking, setCooking] = useState(false);
  const [cooked, setCooked] = useState(false);
  const [message, setMessage] = useState("");

  const usedTools = toolNames.filter((tool) => recipe.toolIds.includes(tool.id));

  async function save() {
    if (!user) return;
    setSaving(true);
    setMessage("");
    try {
      const id = await saveRecipeToTsukurioki(user.uid, toTsukuriokiRecipe(recipe, usedTools.map((tool) => tool.name), Date.now()));
      setSavedId(id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="ui-section">
      <div className="ui-section__head">
        <h2 className="ui-section__title">{recipe.title}</h2>
        <span className="ui-muted">{recipe.category}・{recipe.servings}人分・{recipe.estMinutes}分</span>
      </div>

      {recipe.warnings.length > 0 && (
        <ul className="ui-status-note">{recipe.warnings.map((w) => <li key={w}><TriangleAlert size={14} className="inline mr-1" />{w}</li>)}</ul>
      )}

      <h3 className="ui-muted mt-3">材料</h3>
      <ul className="ui-list">
        {recipe.ingredients.map((ing, i) => (
          <li key={`${ing.name}-${i}`} className="flex items-center justify-between gap-3">
            <span>{ing.name} <span className="ui-muted">{`${ing.amount}${ing.unit}`}</span></span>
            {ing.itemId ? <span className="ui-badge ui-badge--green">在庫</span> : ing.inStock ? <span className="ui-badge ui-badge--slate">家にある</span> : <span className="ui-badge ui-badge--red">買い足し</span>}
          </li>
        ))}
      </ul>

      <h3 className="ui-muted mt-3">作り方</h3>
      <ol className="list-decimal pl-5 space-y-1">{recipe.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>

      {usedTools.length > 0 && <p className="ui-muted mt-3">使う器具：{usedTools.map((tool) => tool.name).join("、")}</p>}

      {message && <p role="alert" className="ui-error mt-3">{message}</p>}
      {cooked && <p className="ui-status-note mt-3"><Check size={14} className="inline mr-1" />在庫を減らしました。</p>}

      <div className="ui-form-actions mt-4">
        {savedId
          ? <Link href="/recipe" className="ui-button ui-button--secondary"><Check size={16} />つくりおきノートに保存しました</Link>
          : <button type="button" onClick={save} disabled={saving} className="ui-button ui-button--secondary"><BookmarkPlus size={16} />{saving ? "保存中" : "つくりおきノートに保存"}</button>}
        <button type="button" onClick={() => setCooking(true)} disabled={cooked} className="ui-button ui-button--primary"><ChefHat size={16} />作った</button>
      </div>

      {cooking && (
        <CookedDialog
          recipe={recipe}
          items={pantryItems}
          savedRecipeId={savedId}
          onClose={() => setCooking(false)}
          onDone={() => { setCooking(false); setCooked(true); }}
        />
      )}
    </article>
  );
}

/** 「作った」ときに、どの在庫をどれだけ減らすかを確かめて決める。 */
function CookedDialog({ recipe, items, savedRecipeId, onClose, onDone }: {
  recipe: RecipeSuggestion;
  items: ReturnType<typeof useInventory>["items"];
  savedRecipeId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const [rows, setRows] = useState<CookedRow[]>(() =>
    defaultConsumption(recipe, items.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, unit: item.unit ?? "", category: item.category ?? "" })))
      .map((row) => ({ ...row, locationId: byId.get(row.itemId)?.locationId })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      // 在庫の数量は、ダイアログを開いた後に別の端末で変わっているかもしれないので、最新の値で計算し直す
      const fresh = rows.map((row) => ({ ...row, available: byId.get(row.itemId)?.quantity ?? row.available }));
      await recordCooking(user.uid, fresh, recipe.title, savedRecipeId);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "在庫を減らせませんでした。");
      setBusy(false);
    }
  }

  return (
    <div className="ui-save-overlay" role="presentation">
      <section className="ui-save-dialog w-full max-w-md text-left" role="dialog" aria-modal="true" aria-label="作った食材の在庫を減らす">
        <h2 className="ui-save-dialog__title">使った量を確かめてください</h2>
        <p className="ui-muted mt-1">この量だけ在庫を減らします。0にした食材は減らしません。</p>
        {rows.length === 0 ? <p className="ui-muted mt-4">在庫から使う食材がありません。</p> : (
          <div className="ui-list mt-4">
            {rows.map((row, index) => (
              <label key={row.itemId} className="flex items-center justify-between gap-3">
                <span>
                  {row.name}<span className="ui-muted">（在庫 {row.available}{row.unit}）</span>
                  {row.note && <span className="ui-muted block text-xs">{row.note}</span>}
                </span>
                <span className="flex items-center gap-1">
                  <input
                    type="number" min={0} max={row.available} step="any" inputMode="decimal" className="w-20"
                    value={row.use}
                    onChange={(event) => {
                      const value = Math.max(0, Math.min(Number(event.target.value) || 0, row.available));
                      setRows(rows.map((r, i) => (i === index ? { ...r, use: value } : r)));
                    }}
                    aria-label={`${row.name}を減らす量`}
                  />
                  <span className="ui-muted">{row.unit}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {error && <p role="alert" className="ui-error mt-3">{error}</p>}
        <div className="ui-form-actions mt-5">
          <button type="button" onClick={onClose} disabled={busy} className="ui-button ui-button--secondary">やめる</button>
          <button type="button" onClick={confirm} disabled={busy || rows.length === 0} className="ui-button ui-button--primary">{busy ? "減らしています" : "在庫を減らす"}</button>
        </div>
      </section>
    </div>
  );
}
