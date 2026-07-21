"use client";

import Image from "next/image";
import Link from "next/link";
import type { Item } from "@/lib/types/item";
import { formatDate, isExpired, isExpiringSoon } from "@/lib/utils/dates";
import { isLowStock } from "@/lib/utils/inventory";
import { Badge } from "@/components/common/Badge";

export function ItemCard({ item, locationLabel }: { item: Item; locationLabel?: string }) {
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
          <p className="ui-item-card__quantity">{item.quantity}<span className="ml-1 text-xs font-semibold text-[var(--ink-muted)]">{item.unit}</span></p>
        </div>
        <div className="ui-item-card__badges">
          {item.category && <Badge>{item.category}</Badge>}
          {item.statusMemo && <Badge tone="blue">{item.statusMemo}</Badge>}
          {item.expirationDate && <Badge tone={isExpired(item.expirationDate) ? "red" : isExpiringSoon(item.expirationDate) ? "amber" : "slate"}>{item.expirationType || "期限"}: {formatDate(item.expirationDate)}</Badge>}
          {isLowStock(item) && <Badge tone="amber">残り少ない</Badge>}
        </div>
        {item.memo && <p className="ui-item-card__memo">{item.memo}</p>}
        <Link href={`/app/items/${item.id}/edit`} className="ui-button ui-button--ghost mt-2">編集</Link>
      </div>
    </article>
  );
}

