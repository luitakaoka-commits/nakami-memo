"use client";

import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { locationLabelOf, useInventory } from "@/lib/hooks/useInventory";
import { searchInventory } from "@/lib/utils/inventory";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { ItemCard } from "@/components/items/ItemCard";

export function InventorySearch() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const [keyword, setKeyword] = useState(initialQuery);
  const { itemsWithLocation, loading, error } = useInventory();
  const results = useMemo(() => searchInventory(itemsWithLocation, keyword), [itemsWithLocation, keyword]);

  if (loading) return <LoadingState label="検索データを読み込み中" />;
  if (error) return <ErrorState error={error} title="検索データを読み込めませんでした。" />;

  return (
    <div className="ui-stack">
      <section className="ui-form-surface">
        <div className="ui-page-head"><h1 className="ui-page-title">検索</h1><span className="ui-section__count">{results.length}件</span></div>
        <label className="ui-form-field mt-6">
          <span className="sr-only">キーワード</span>
          <div className="relative"><Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} className="pl-10" placeholder="アイテム・場所・カテゴリ" autoFocus /></div>
        </label>
      </section>

      <section className="ui-section">
        <div className="ui-section__head"><h2 className="ui-section__title">検索結果</h2><span className="ui-section__count">{results.length}件</span></div>
        <div className="ui-list">{results.length ? results.map((item) => <ItemCard key={item.id} item={item} locationLabel={locationLabelOf(item)} />) : <p className="ui-empty__title">該当なし</p>}</div>
      </section>
    </div>
  );
}

