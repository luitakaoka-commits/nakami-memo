"use client";

import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { useMemo } from "react";
import { locationLabelOf, useInventory } from "@/lib/hooks/useInventory";
import { getExpiringItems, isLowStock, sortAreas, sortLocations } from "@/lib/utils/inventory";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { ItemCard } from "@/components/items/ItemCard";
import { OutOfStockCleanup } from "@/components/items/OutOfStockCleanup";

export function Dashboard() {
  const { areas, locations, itemsWithLocation, loading, error } = useInventory();

  const expiringAll = useMemo(() => getExpiringItems(itemsWithLocation, 7), [itemsWithLocation]);
  const expiringItems = expiringAll.slice(0, 5);
  const lowStockAll = useMemo(() => itemsWithLocation.filter(isLowStock), [itemsWithLocation]);
  const lowStockItems = lowStockAll.slice(0, 5);
  const recentItems = useMemo(
    () => [...itemsWithLocation].sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)).slice(0, 5),
    [itemsWithLocation],
  );
  const grouped = useMemo(
    () => sortAreas(areas).map((area) => ({ area, locations: sortLocations(locations.filter((location) => location.areaId === area.id)) })),
    [areas, locations],
  );

  if (loading) return <LoadingState label="読み込み中" />;
  if (error) return <ErrorState error={error} />;

  // ホームはシートの積み重ね（docs/ui-unification/design-board.html ①）。画面名「ホーム」はヘッダーが出す
  return (
    <div className="ui-sheets">
      <h1 className="sr-only">ホーム</h1>

      <div className="ui-home-tools">
        <form action="/app/search" className="ui-search-form">
          <input name="q" className="ui-input" placeholder="アイテム・場所・カテゴリ" aria-label="検索" />
          <button type="submit" className="ui-button ui-button--secondary"><Search size={17} strokeWidth={2} /><span>検索</span></button>
        </form>
        <Link href="/app/items/new" className="ui-button ui-button--primary"><Plus size={17} strokeWidth={2} /><span>追加</span></Link>
      </div>

      {/* 先頭シート：期限が近いものの件数を大きく。ほかの統計は補助数字の1行にまとめる */}
      <section className="ui-sheet ui-sheet--lead" aria-labelledby="home-expiring">
        <div className="ui-sheet__head">
          <h2 id="home-expiring" className="ui-sheet__title">期限が近いもの</h2>
          <div className="ui-sheet__links">{expiringAll.length > 0 && <Link href="/app/recipes" className="ui-sheet__link">レシピを考える</Link>}<Link href="/app/expiring" className="ui-sheet__link">すべて</Link></div>
        </div>
        <p className="ui-amount">{expiringAll.length}<small>件</small></p>
        <p className="ui-support">アイテム {itemsWithLocation.length} ・ 保管場所 {locations.length} ・ 買い替え {lowStockAll.length}</p>
        <div className="ui-list">{expiringItems.length ? expiringItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={locationLabelOf(item)} />) : <p className="ui-muted">該当なし</p>}</div>
      </section>

      {areas.length === 0 ? <EmptyState title="エリアがありません" actionLabel="エリアを追加" href="/app/areas" /> : locations.length === 0 ? <EmptyState title="保管場所がありません" actionLabel="保管場所を追加" href="/app/locations/new" /> : null}

      <OutOfStockCleanup items={itemsWithLocation} />

      <section className="ui-sheet" aria-labelledby="home-low-stock">
        <div className="ui-sheet__head"><h2 id="home-low-stock" className="ui-sheet__title">買い替え時のもの</h2><Link href="/app/low-stock" className="ui-sheet__link">すべて</Link></div>
        <div className="ui-list">{lowStockItems.length ? lowStockItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={locationLabelOf(item)} />) : <p className="ui-muted">該当なし。買い替えアラームを付けたモノが残り少なくなると、ここに出ます。</p>}</div>
      </section>

      <section className="ui-sheet" aria-labelledby="home-recent">
        <div className="ui-sheet__head"><h2 id="home-recent" className="ui-sheet__title">最近追加したアイテム</h2><Link href="/app/items/new" className="ui-sheet__link">追加</Link></div>
        <div className="ui-list">{recentItems.length ? recentItems.map((item) => <ItemCard key={item.id} item={item} locationLabel={locationLabelOf(item)} />) : <p className="ui-muted">該当なし</p>}</div>
      </section>

      <section className="ui-sheet" aria-labelledby="home-locations">
        <div className="ui-sheet__head"><h2 id="home-locations" className="ui-sheet__title">エリア別の保管場所</h2><Link href="/app/locations" className="ui-sheet__link">管理</Link></div>
        <div className="ui-area-groups">
          {grouped.map(({ area, locations: areaLocations }) => areaLocations.length > 0 && <div key={area.id} className="ui-area-group"><h3 className="ui-area-group__name">{area.name}</h3><div className="ui-chip-list">{areaLocations.map((location) => <Link key={location.id} href={`/app/locations/${location.id}`} className="ui-chip">{location.name}</Link>)}</div></div>)}
        </div>
      </section>
    </div>
  );
}

