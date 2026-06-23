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
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
