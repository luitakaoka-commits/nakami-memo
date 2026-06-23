"use client";

import Image from "next/image";
import Link from "next/link";
import type { Item } from "@/lib/types/item";
import { formatDate, isExpired, isExpiringSoon } from "@/lib/utils/dates";
import { isLowStock } from "@/lib/utils/inventory";
import { Badge } from "@/components/common/Badge";

export function ItemCard({ item, locationLabel }: { item: Item; locationLabel?: string }) {
  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="flex gap-4 p-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
          {item.imageUrl ? <Image src={item.imageUrl} alt={item.name} fill sizes="80px" className="object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">No Image</div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-900">{item.name}</h3>
              {locationLabel && <p className="mt-1 text-xs text-slate-500">{locationLabel}</p>}
            </div>
            <p className="shrink-0 text-lg font-black text-slate-900">{item.quantity}<span className="ml-1 text-sm font-semibold text-slate-500">{item.unit}</span></p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {item.category && <Badge>{item.category}</Badge>}
            {item.statusMemo && <Badge tone="blue">{item.statusMemo}</Badge>}
            {item.expirationDate && <Badge tone={isExpired(item.expirationDate) ? "red" : isExpiringSoon(item.expirationDate) ? "amber" : "slate"}>{item.expirationType || "期限"}: {formatDate(item.expirationDate)}</Badge>}
            {isLowStock(item) && <Badge tone="amber">残り少ない</Badge>}
          </div>
          {item.memo && <p className="mt-3 line-clamp-2 text-sm text-slate-500">{item.memo}</p>}
          <div className="mt-3">
            <Link href={`/app/items/${item.id}/edit`} className="text-sm font-bold text-brand-700">編集する</Link>
          </div>
        </div>
      </div>
    </article>
  );
}
