"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAreas } from "@/lib/hooks/useAreas";
import { useAuth } from "@/lib/hooks/useAuth";
import { useItems } from "@/lib/hooks/useItems";
import { useLocations } from "@/lib/hooks/useLocations";
import { getExpiringItems, isLowStock, joinItemsWithLocations, sortAreas, sortLocations } from "@/lib/utils/inventory";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { ItemCard } from "@/components/items/ItemCard";

export function Dashboard() {
  const { user } = useAuth();
  const { areas, loading: areasLoading } = useAreas(user?.uid);
  const { locations, loading: locationsLoading } = useLocations(user?.uid);
  const { items, loading: itemsLoading } = useItems(user?.uid);

  const itemsWithLocation = useMemo(() => joinItemsWithLocations(items, locations, areas), [areas, items, locations]);
  const expiringItems = useMemo(() => getExpiringItems(itemsWithLocation, 7).slice(0, 5), [itemsWithLocation]);
  const lowStockItems = useMemo(() => itemsWithLocation.filter(isLowStock).slice(0, 5), [itemsWithLocation]);
  const recentItems = useMemo(() => [...itemsWithLocation].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)).slice(0, 5), [itemsWithLocation]);
  const grouped = useMemo(() => sortAreas(areas).map((area) => ({ area, locations: sortLocations(locations.filter((location) => location.areaId === area.id)) })), [areas, locations]);

  if (areasLoading || locationsLoading || itemsLoading) return <LoadingState label="ダッシュボードを読み込み中" />;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-gradient-to-br from-brand-600 to-brand-700 p-6 text-white shadow-soft">
        <p className="text-sm font-semibold text-brand-100">なかみメモ</p>
        <h1 className="mt-2 text-2xl font-black">家の在庫、ちゃんと見えてます。</h1>
        <p className="mt-2 text-sm leading-6 text-brand-50">検索・期限・低在庫・QRをここから確認できます。冷蔵庫の奥で発掘される古代文明、そろそろ終わらせましょう。</p>
        <form action="/app/search" className="mt-5 flex gap-2">
          <input name="q" className="min-w-0 flex-1 rounded-2xl border-0 text-slate-900" placeholder="アイテム名・カテゴリ・保管場所で検索" />
          <button className="rounded-2xl bg-white px-4 py-2 text-sm font-bold text-brand-700">検索</button>
        </form>
      </section>

      {areas.length === 0 ? (
        <EmptyState title="まずはエリアを作成しましょう" description="キッチン、玄関、クローゼットなどから始めるのがおすすめです。" actionLabel="エリアを作る" href="/app/areas" />
      ) : locations.length === 0 ? (
        <EmptyState title="次は保管場所を追加しましょう" description="冷蔵庫、食品棚、防災備蓄箱などを登録できます。" actionLabel="保管場所を追加" href="/app/locations/new" />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">期限が近いもの</h2>
            <Link href="/app/expiring" className="text-sm font-bold text-brand-700">すべて</Link>
          </div>
          <div className="space-y-3">
            {expiringItems.length ? expiringItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={`${item.areaName} / ${item.locationName}`} />) : <p className="text-sm text-slate-500">期限が近いものはありません。</p>}
          </div>
        </section>

        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">残り少ないもの</h2>
            <Link href="/app/low-stock" className="text-sm font-bold text-brand-700">すべて</Link>
          </div>
          <div className="space-y-3">
            {lowStockItems.length ? lowStockItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={`${item.areaName} / ${item.locationName}`} />) : <p className="text-sm text-slate-500">低在庫のものはありません。</p>}
          </div>
        </section>
      </div>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">エリア別の保管場所</h2>
          <Link href="/app/locations" className="text-sm font-bold text-brand-700">管理</Link>
        </div>
        <div className="space-y-4">
          {grouped.map(({ area, locations }) => locations.length > 0 && (
            <div key={area.id}>
              <h3 className="mb-2 text-sm font-bold text-slate-500">{area.name}</h3>
              <div className="flex flex-wrap gap-2">
                {locations.map((location) => <Link key={location.id} href={`/app/locations/${location.id}`} className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">{location.name}</Link>)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">最近追加したアイテム</h2>
          <Link href="/app/items/new" className="text-sm font-bold text-brand-700">追加</Link>
        </div>
        <div className="space-y-3">
          {recentItems.length ? recentItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={`${item.areaName} / ${item.locationName}`} />) : <p className="text-sm text-slate-500">まだアイテムがありません。</p>}
        </div>
      </section>
    </div>
  );
}
