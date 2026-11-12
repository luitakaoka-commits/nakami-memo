"use client";

import Image from "next/image";
import Link from "next/link";
import type { Item } from "@/lib/types/item";
import { daysUntil, formatDate } from "@/lib/utils/dates";
import { isLowStock } from "@/lib/utils/inventory";
import { isOutOfStock } from "@/lib/inventory/outcome-core";
import { ItemOutcomeActions } from "./ItemOutcomeActions";

type Status = { label: string; tone: "warning" | "danger" | "quiet" };

/**
 * 期限の状態を、チップの語彙（docs/ui-unification/audit.md §4-2）に写す。
 * 期限切れ＝危険、今日・明日・あと3日まで＝注意、それより先＝チップなしの静かな文字。
 */
function expiryStatus(item: Pick<Item, "expirationDate">): Status | null {
  const days = daysUntil(item.expirationDate);
  if (days === null) return null;
  if (days < 0) return { label: "期限切れ", tone: "danger" };
  if (days === 0) return { label: "今日まで", tone: "warning" };
  if (days === 1) return { label: "明日まで", tone: "warning" };
  if (days <= 3) return { label: `あと${days}日`, tone: "warning" };
  return { label: `あと${days}日`, tone: "quiet" };
}

/** 在庫の状態（在庫切れ＝危険、買い替え時＝注意） */
function stockStatus(item: Item): Status | null {
  if (isOutOfStock(item.quantity)) return { label: "在庫切れ", tone: "danger" };
  if (isLowStock(item)) return { label: "買い替え時", tone: "warning" };
  return null;
}

function StatusChip({ status }: { status: Status }) {
  return <span className={status.tone === "quiet" ? "ui-quiet" : `ui-status ui-status--${status.tone}`}>{status.label}</span>;
}

// 明細行（ledger）：左に品名と補助ラベル、右に数量と状態を右寄せ
export function ItemCard({ item, locationLabel }: { item: Item; locationLabel?: string }) {
  const expiry = expiryStatus(item);
  const stock = stockStatus(item);
  const meta = [
    locationLabel,
    item.expirationDate ? `${item.expirationType || "期限"} ${formatDate(item.expirationDate)}` : "",
    item.category,
    item.statusMemo,
  ].filter(Boolean).join(" ・ ");

  return (
    <article className="ui-ledger-row">
      <div className="ui-ledger-row__main">
        {item.imageUrl && (
          <div className="ui-ledger-row__media">
            <Image src={item.imageUrl} alt={item.name} fill sizes="40px" className="object-cover" />
          </div>
        )}
        <div className="ui-ledger-row__l">
          <h3 className="ui-ledger-row__name">{item.name}</h3>
          {meta && <p className="ui-ledger-row__meta">{meta}</p>}
        </div>
        <div className="ui-ledger-row__r">
          <span className="ui-ledger-row__val">{item.quantity}<small>{item.unit}</small></span>
          {stock && <StatusChip status={stock} />}
          {expiry && <StatusChip status={expiry} />}
        </div>
      </div>
      {item.memo && <p className="ui-ledger-row__memo">{item.memo}</p>}
      <div className="ui-ledger-row__actions">
        <Link href={`/app/items/${item.id}/edit`} className="ui-button ui-button--ghost">編集</Link>
        <ItemOutcomeActions item={item} />
      </div>
    </article>
  );
}
