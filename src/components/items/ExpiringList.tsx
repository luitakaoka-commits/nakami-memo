"use client";

import { CalendarClock } from "lucide-react";
import { useMemo } from "react";
import { locationLabelOf, useInventory } from "@/lib/hooks/useInventory";
import { getExpiringItems } from "@/lib/utils/inventory";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { ItemCard } from "@/components/items/ItemCard";

export function ExpiringList() {
  const { itemsWithLocation, loading, error } = useInventory();
  const expiringItems = useMemo(() => getExpiringItems(itemsWithLocation, 30), [itemsWithLocation]);

  if (loading) return <LoadingState label="期限一覧を読み込み中" />;
  if (error) return <ErrorState error={error} title="期限一覧を読み込めませんでした。" />;

  return (
    <div className="ui-stack">
      <div className="ui-page-head"><div className="flex items-center gap-3"><CalendarClock size={25} className="text-[var(--amber)]" /><h1 className="ui-page-title">期限一覧</h1></div><span className="ui-section__count">{expiringItems.length}件</span></div>
      <div className="ui-list">{expiringItems.length ? expiringItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={locationLabelOf(item)} />) : <p className="ui-empty__title">該当なし</p>}</div>
    </div>
  );
}

