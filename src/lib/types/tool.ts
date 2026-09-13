import type { Timestamp } from "firebase/firestore";

/** 調理器具（users/{uid}/tools）。レシピ提案で「持っていない器具を使わせない」ために登録する。 */
export type Tool = {
  id: string;
  name: string;
  type: string;
  sizeLabel?: string;
  features?: string[];
  memo?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

export type ToolInput = {
  name: string;
  type: string;
  sizeLabel?: string;
  features: string[];
  memo?: string;
};
