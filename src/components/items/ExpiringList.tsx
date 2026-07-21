"use client";

import { CalendarClock } from "lucide-react";
import { useMemo } from "react";
import { useAreas } from "@/lib/hooks/useAreas";
import { useAuth } from "@/lib/hooks/useAuth";
import { useItems } from "@/lib/hooks/useItems";
import { useLocations } from "@/lib/hooks/useLocations";
import { getExpiringItems, joinItemsWithLocations } from "@/lib/utils/inventory";
import { LoadingState } from "@/components/common/LoadingState";
import { ItemCard } from "@/components/items/ItemCard";

export function ExpiringList() {
  const { user } = useAuth();
  const { areas } = useAreas(user?.uid);
  const { locations } = useLocations(user?.uid);
  const { items, loading } = useItems(user?.uid);
  const expiringItems = useMemo(() => getExpiringItems(joinItemsWithLocations(items, locations, areas), 30), [areas, items, locations]);

  if (loading) return <LoadingState label="期限一覧を読み込み中" />;

  return (
    <div className="ui-stack">
      <div className="ui-page-head"><div className="flex items-center gap-3"><CalendarClock size={25} className="text-[var(--amber)]" /><h1 className="ui-page-title">期限一覧</h1></div><span className="ui-section__count">{expiringItems.length}件</span></div>
      <div className="ui-list">{expiringItems.length ? expiringItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={`${item.areaName} / ${item.locationName}`} />) : <p className="ui-empty__title">該当なし</p>}</div>
    </div>
  );
}

