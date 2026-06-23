"use client";

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
    <div className="space-y-5">
      <section className="rounded-3xl bg-white p-5 shadow-soft">
        <h1 className="text-2xl font-black text-slate-900">検索</h1>
        <p className="mt-1 text-sm text-slate-500">アイテム名、カテゴリ、メモ、保管場所名を横断検索します。</p>
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} className="mt-5 w-full rounded-2xl border-slate-200" placeholder="例：USB-Cケーブル" autoFocus />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-900">検索結果</h2>
          <span className="text-sm font-semibold text-slate-500">{results.length}件</span>
        </div>
        {results.length ? results.map((item) => <ItemCard key={item.id} item={item} locationLabel={`${item.areaName} / ${item.locationName}`} />) : <p className="rounded-2xl bg-white p-5 text-sm text-slate-500">該当するアイテムがありません。</p>}
      </section>
    </div>
  );
}
