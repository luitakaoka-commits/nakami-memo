"use client";

import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAreas } from "@/lib/hooks/useAreas";
import { useAuth } from "@/lib/hooks/useAuth";
import { useItems } from "@/lib/hooks/useItems";
import { useLocations } from "@/lib/hooks/useLocations";
import { joinItemsWithLocations, searchInventory } from "@/lib/utils/inventory";
import { LoadingState } from "@/components/common/LoadingState";
import { ItemCard } from "@/components/items/ItemCard";

export function InventorySearch() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const [keyword, setKeyword] = useState(initialQuery);
  const { user } = useAuth();
  const { areas } = useAreas(user?.uid);
  const { locations } = useLocations(user?.uid);
  const { items, loading } = useItems(user?.uid);
  const itemsWithLocation = useMemo(() => joinItemsWithLocations(items, locations, areas), [areas, items, locations]);
  const results = useMemo(() => searchInventory(itemsWithLocation, keyword), [itemsWithLocation, keyword]);

  if (loading) return <LoadingState label="検索データを読み込み中" />;

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
        <div className="ui-list">{results.length ? results.map((item) => <ItemCard key={item.id} item={item} locationLabel={`${item.areaName} / ${item.locationName}`} />) : <p className="ui-empty__title">該当なし</p>}</div>
      </section>
    </div>
  );
}

