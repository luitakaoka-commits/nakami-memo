import type { Timestamp } from "firebase/firestore";

export const UNIT_OPTIONS = [
  "個",
  "本",
  "枚",
  "袋",
  "箱",
  "冊",
  "セット",
  "ロール",
  "パック",
  "食",
  "kg",
  "g",
  "L",
  "mL",
] as const;

export const CATEGORY_OPTIONS = [
  "食品",
  "飲料",
  "調味料",
  "日用品",
  "洗剤",
  "薬",
  "防災用品",
  "電池",
  "ケーブル",
  "書類",
  "衣類",
  "工具",
  "掃除用品",
  "趣味用品",
  "季節用品",
  "その他",
] as const;

export const EXPIRATION_TYPE_OPTIONS = [
  "賞味期限",
  "消費期限",
  "使用期限",
  "交換期限",
  "保管期限",
  "その他",
] as const;

export const NOTIFY_DAYS_OPTIONS = [1, 3, 7, 14, 30] as const;

export type Item = {
  id: string;
  locationId: string;
  name: string;
  quantity: number;
  unit?: string;
  statusMemo?: string;
  category?: string;
  expirationDate?: Timestamp | null;
  expirationType?: string;
  notifyDaysBefore?: number | null;
  imageUrl?: string;
  memo?: string;
  lowStockThreshold?: number | null;
  /* ---- お金管理から来た在庫だけが持つ（「在庫に入れる」で書かれる。2026-09-16） ---- */
  /** どのレシートの何行目から来たか（`レシートID#行番号`） */
  purchaseRef?: string;
  /** 買ったときの金額。捨てたときに、いくら無駄だったかを出すのに使う */
  purchasePrice?: number;
  /** お金管理のどの共有スペースか。結末を明細に返すときの宛先 */
  purchaseWorkspaceId?: string;
  /* ---- 「使い切った／捨てた」の記録（2026-09-16） ---- */
  outcome?: string;
  outcomeAt?: string;
  outcomeReason?: string;
  // serverTimestamp() の直後（pending write のスナップショット）では null になる。
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

export type ItemInput = {
  locationId: string;
  name: string;
  quantity: number;
  unit?: string;
  statusMemo?: string;
  category?: string;
  expirationDate?: Date | null;
  expirationType?: string;
  notifyDaysBefore?: number | null;
  memo?: string;
  lowStockThreshold?: number | null;
};

export type ItemWithLocation = Item & {
  locationName: string;
  areaName: string;
};

export type PublicItem = {
  name: string;
  quantity: number;
  unit?: string;
};
