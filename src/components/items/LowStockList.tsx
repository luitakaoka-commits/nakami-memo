"use client";

import { PackageSearch } from "lucide-react";
import { useMemo } from "react";
import { useAreas } from "@/lib/hooks/useAreas";
import { useAuth } from "@/lib/hooks/useAuth";
import { useItems } from "@/lib/hooks/useItems";
import { useLocations } from "@/lib/hooks/useLocations";
import { isLowStock, joinItemsWithLocations } from "@/lib/utils/inventory";
import { LoadingState } from "@/components/common/LoadingState";
import { ItemCard } from "@/components/items/ItemCard";

export function LowStockList() {
  const { user } = useAuth();
  const { areas } = useAreas(user?.uid);
  const { locations } = useLocations(user?.uid);
  const { items, loading } = useItems(user?.uid);
  const lowStockItems = useMemo(() => joinItemsWithLocations(items, locations, areas).filter(isLowStock), [areas, items, locations]);

  if (loading) return <LoadingState label="在庫一覧を読み込み中" />;

  return (
    <div className="ui-stack">
      <div className="ui-page-head"><div className="flex items-center gap-3"><PackageSearch size={25} className="text-[var(--brand)]" /><h1 className="ui-page-title">残り少ないもの</h1></div><span className="ui-section__count">{lowStockItems.length}件</span></div>
      <div className="ui-list">{lowStockItems.length ? lowStockItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={`${item.areaName} / ${item.locationName}`} />) : <p className="ui-empty__title">該当なし</p>}</div>
    </div>
  );
}

