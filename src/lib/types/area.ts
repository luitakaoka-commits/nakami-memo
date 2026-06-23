import type { Timestamp } from "firebase/firestore";

export type Area = {
  id: string;
  name: string;
  sortOrder?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type AreaInput = {
  name: string;
  sortOrder?: number | null;
};
