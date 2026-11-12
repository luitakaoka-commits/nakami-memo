"use client";

import { CalendarClock } from "lucide-react";
import { useMemo } from "react";
import { locationLabelOf, useInventory } from "@/lib/hooks/useInventory";
import { getExpiringItems } from "@/lib/utils/inventory";
import { daysUntil } from "@/lib/utils/dates";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { ItemCard } from "@/components/items/ItemCard";

// 緊急度のグループ（design-board ②）。並び順は getExpiringItems の近い順のまま、見出しで区切るだけ
const GROUPS = [
  { key: "now", title: "すぐ使う", test: (days: number) => days <= 1 },
  { key: "week", title: "今週中", test: (days: number) => days >= 2 && days <= 7 },
  { key: "later", title: "まだ余裕", test: (days: number) => days > 7 },
];

export function ExpiringList() {
  const { itemsWithLocation, loading, error } = useInventory();
  const expiringItems = useMemo(() => getExpiringItems(itemsWithLocation, 30), [itemsWithLocation]);
  const groups = useMemo(
    () => GROUPS.map((group) => ({ ...group, items: expiringItems.filter((item) => group.test(daysUntil(item.expirationDate) ?? Number.POSITIVE_INFINITY)) })).filter((group) => group.items.length > 0),
    [expiringItems],
  );

  if (loading) return <LoadingState label="期限一覧を読み込み中" />;
  if (error) return <ErrorState error={error} title="期限一覧を読み込めませんでした。" />;

  return (
    <div className="ui-stack">
      <div className="ui-page-head"><div className="flex items-center gap-3"><CalendarClock size={25} className="text-[var(--amber)]" /><h1 className="ui-page-title">期限一覧</h1></div><span className="ui-count">{expiringItems.length}件</span></div>
      {groups.length ? (
        groups.map((group) => (
          <section key={group.key} className="ui-group" aria-labelledby={`expiring-${group.key}`}>
            <div className="ui-group__head"><h2 id={`expiring-${group.key}`} className="ui-group__title">{group.title}</h2><span className="ui-count">{group.items.length}件</span></div>
            <div className="ui-sheet"><div className="ui-list">{group.items.map((item) => <ItemCard key={item.id} item={item} locationLabel={locationLabelOf(item)} />)}</div></div>
          </section>
        ))
      ) : (
        <div className="ui-sheet"><p className="ui-empty__title">該当なし</p></div>
      )}
    </div>
  );
}
