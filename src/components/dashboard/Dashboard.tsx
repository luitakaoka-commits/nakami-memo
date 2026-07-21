"use client";

import Link from "next/link";
import { CalendarClock, MapPin, PackageSearch, Plus, Search } from "lucide-react";
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
  const expiringAll = useMemo(() => getExpiringItems(itemsWithLocation, 7), [itemsWithLocation]);
  const expiringItems = expiringAll.slice(0, 5);
  const lowStockAll = useMemo(() => itemsWithLocation.filter(isLowStock), [itemsWithLocation]);
  const lowStockItems = lowStockAll.slice(0, 5);
  const recentItems = useMemo(
    () => [...itemsWithLocation].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)).slice(0, 5),
    [itemsWithLocation],
  );
  const grouped = useMemo(
    () => sortAreas(areas).map((area) => ({ area, locations: sortLocations(locations.filter((location) => location.areaId === area.id)) })),
    [areas, locations],
  );

  if (areasLoading || locationsLoading || itemsLoading) return <LoadingState label="読み込み中" />;

  return (
    <div className="ui-stack">
      <section className="ui-commandbar">
        <div><p className="ui-kicker">なかみメモ</p><h1>ホーム</h1></div>
        <div className="ui-commandbar__actions">
          <form action="/app/search" className="ui-search-form">
            <input name="q" className="ui-input" placeholder="アイテム・場所・カテゴリ" aria-label="検索" />
            <button type="submit" className="ui-button ui-button--on-dark"><Search size={17} strokeWidth={2} /><span>検索</span></button>
          </form>
          <Link href="/app/items/new" className="ui-button ui-button--on-dark"><Plus size={17} strokeWidth={2} /><span>追加</span></Link>
        </div>
      </section>

      <div className="ui-stat-grid" aria-label="在庫サマリー">
        <div className="ui-stat"><span className="ui-stat__label">アイテム</span><strong className="ui-stat__value">{itemsWithLocation.length}</strong></div>
        <div className="ui-stat"><span className="ui-stat__label">保管場所</span><strong className="ui-stat__value">{locations.length}</strong></div>
        <div className="ui-stat"><span className="ui-stat__label">期限</span><strong className="ui-stat__value">{expiringAll.length}</strong></div>
        <div className="ui-stat"><span className="ui-stat__label">少ない</span><strong className="ui-stat__value">{lowStockAll.length}</strong></div>
      </div>

      {areas.length === 0 ? <EmptyState title="エリアがありません" actionLabel="エリアを追加" href="/app/areas" /> : locations.length === 0 ? <EmptyState title="保管場所がありません" actionLabel="保管場所を追加" href="/app/locations/new" /> : null}

      <div className="ui-grid-two">
        <section className="ui-section">
          <div className="ui-section__head"><div className="flex items-center gap-2"><CalendarClock size={18} className="text-[var(--amber)]" /><h2 className="ui-section__title">期限が近いもの</h2></div><Link href="/app/expiring" className="ui-button ui-button--ghost">すべて</Link></div>
          <div className="ui-list">{expiringItems.length ? expiringItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={`${item.areaName} / ${item.locationName}`} />) : <p className="ui-muted">該当なし</p>}</div>
        </section>

        <section className="ui-section">
          <div className="ui-section__head"><div className="flex items-center gap-2"><PackageSearch size={18} className="text-[var(--brand)]" /><h2 className="ui-section__title">残り少ないもの</h2></div><Link href="/app/low-stock" className="ui-button ui-button--ghost">すべて</Link></div>
          <div className="ui-list">{lowStockItems.length ? lowStockItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={`${item.areaName} / ${item.locationName}`} />) : <p className="ui-muted">該当なし</p>}</div>
        </section>
      </div>

      <section className="ui-section">
        <div className="ui-section__head"><div className="flex items-center gap-2"><MapPin size={18} className="text-[var(--blue)]" /><h2 className="ui-section__title">エリア別の保管場所</h2></div><Link href="/app/locations" className="ui-button ui-button--ghost">管理</Link></div>
        <div className="ui-list">
          {grouped.map(({ area, locations: areaLocations }) => areaLocations.length > 0 && <div key={area.id} className="ui-section"><h3 className="ui-muted">{area.name}</h3><div className="ui-chip-list">{areaLocations.map((location) => <Link key={location.id} href={`/app/locations/${location.id}`} className="ui-chip">{location.name}</Link>)}</div></div>)}
        </div>
      </section>

      <section className="ui-section">
        <div className="ui-section__head"><h2 className="ui-section__title">最近追加したアイテム</h2><Link href="/app/items/new" className="ui-button ui-button--ghost">追加</Link></div>
        <div className="ui-list">{recentItems.length ? recentItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={`${item.areaName} / ${item.locationName}`} />) : <p className="ui-muted">該当なし</p>}</div>
      </section>
    </div>
  );
}

