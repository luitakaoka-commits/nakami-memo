import type { Timestamp } from "firebase/firestore";

export const LOCATION_TYPE_OPTIONS = [
  "冷蔵庫",
  "冷凍庫",
  "野菜室",
  "食品棚",
  "収納ボックス",
  "クローゼット",
  "衣装ケース",
  "洗面台収納",
  "玄関収納",
  "工具箱",
  "書類ケース",
  "防災備蓄箱",
  "薬箱",
  "その他",
] as const;

export type Location = {
  id: string;
  areaId: string;
  name: string;
  type?: string;
  imageUrl?: string;
  memo?: string;
  labelName?: string;
  sortOrder?: number;
  isPublic: boolean;
  publicToken?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type LocationInput = {
  areaId: string;
  name: string;
  type?: string;
  memo?: string;
  labelName?: string;
  sortOrder?: number | null;
  isPublic?: boolean;
};
