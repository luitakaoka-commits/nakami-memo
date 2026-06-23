"use client";

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
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black text-slate-900">期限一覧</h1>
        <p className="mt-1 text-sm text-slate-500">期限切れと30日以内のアイテムを表示します。</p>
      </div>
      <div className="space-y-3">
        {expiringItems.length ? expiringItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={`${item.areaName} / ${item.locationName}`} />) : <p className="rounded-2xl bg-white p-5 text-sm text-slate-500">期限が近いアイテムはありません。</p>}
      </div>
    </div>
  );
}
