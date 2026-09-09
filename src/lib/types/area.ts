import type { Timestamp } from "firebase/firestore";

export type Area = {
  id: string;
  name: string;
  sortOrder?: number;
  // serverTimestamp() の直後（pending write のスナップショット）では null になる。
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

export type AreaInput = {
  name: string;
  sortOrder?: number | null;
};
