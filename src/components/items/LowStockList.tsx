"use client";

import { PackageSearch } from "lucide-react";
import { useMemo } from "react";
import { locationLabelOf, useInventory } from "@/lib/hooks/useInventory";
import { isLowStock } from "@/lib/utils/inventory";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { ItemCard } from "@/components/items/ItemCard";

export function LowStockList() {
  const { itemsWithLocation, loading, error } = useInventory();
  const lowStockItems = useMemo(() => itemsWithLocation.filter(isLowStock), [itemsWithLocation]);

  if (loading) return <LoadingState label="在庫一覧を読み込み中" />;
  if (error) return <ErrorState error={error} title="在庫一覧を読み込めませんでした。" />;

  return (
    <div className="ui-stack">
      <div className="ui-page-head"><div className="flex items-center gap-3"><PackageSearch size={25} className="text-[var(--brand)]" /><h1 className="ui-page-title">残り少ないもの</h1></div><span className="ui-section__count">{lowStockItems.length}件</span></div>
      <div className="ui-list">{lowStockItems.length ? lowStockItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={locationLabelOf(item)} />) : <p className="ui-empty__title">該当なし</p>}</div>
    </div>
  );
}

