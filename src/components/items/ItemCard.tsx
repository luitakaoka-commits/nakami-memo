"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { Item } from "@/lib/types/item";
import { formatDate, isExpired, isExpiringSoon } from "@/lib/utils/dates";
import { isLowStock } from "@/lib/utils/inventory";
import { Badge } from "@/components/common/Badge";
import { ItemOutcomeActions } from "./ItemOutcomeActions";
import { QuantityCarousel } from "./QuantityCarousel";
import { formatQuantity } from "@/lib/inventory/quantity-core";

/** actions は「編集」の横に並べる操作（保管場所の画面の「削除」など）。カードの上に重ねて置かないこと（2026-11-14 に「捨てた」と重なった） */
export function ItemCard({ item, locationLabel, actions }: { item: Item; locationLabel?: string; actions?: React.ReactNode }) {
  // 数を押すとカルーセルが開き、その場で数量を変えられる（2026-11-14 ユーザー要望）
  const [editingQuantity, setEditingQuantity] = useState(false);
  return (
    <article className="ui-item-card">
      <div className="ui-item-card__media">
        {item.imageUrl ? <Image src={item.imageUrl} alt={item.name} fill sizes="72px" className="object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-[var(--ink-muted)]">写真なし</div>}
      </div>
      <div className="ui-item-card__body">
        <div className="ui-item-card__top">
          <div className="min-w-0">
            <h3 className="ui-item-card__name">{item.name}</h3>
            {locationLabel && <p className="ui-item-card__meta">{locationLabel}</p>}
          </div>
          <button
            type="button"
            className="ui-item-card__quantity"
            aria-expanded={editingQuantity}
            aria-label={`数量 ${formatQuantity(item.quantity)}${item.unit ?? ""}。押すと変えられます`}
            onClick={() => setEditingQuantity((open) => !open)}
          >
            {formatQuantity(item.quantity)}<span className="ml-1 text-xs font-semibold text-[var(--ink-muted)]">{item.unit}</span>
            <ChevronDown size={14} strokeWidth={2.2} className="ui-item-card__quantity-cue" aria-hidden="true" />
          </button>
        </div>
        {editingQuantity && <QuantityCarousel item={item} onClose={() => setEditingQuantity(false)} />}
        <div className="ui-item-card__badges">
          {item.category && <Badge>{item.category}</Badge>}
          {item.statusMemo && <Badge tone="blue">{item.statusMemo}</Badge>}
          {item.expirationDate && <Badge tone={isExpired(item.expirationDate) ? "red" : isExpiringSoon(item.expirationDate) ? "amber" : "slate"}>{item.expirationType || "期限"}: {formatDate(item.expirationDate)}</Badge>}
          {isLowStock(item) && <Badge tone="amber">買い替え時</Badge>}
        </div>
        {item.memo && <p className="ui-item-card__memo">{item.memo}</p>}
        <div className="ui-item-card__tools">
          <Link href={`/app/items/${item.id}/edit`} className="ui-button ui-button--ghost">編集</Link>
          {actions}
        </div>
        <ItemOutcomeActions item={item} />
      </div>
    </article>
  );
}

