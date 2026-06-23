import type { PublicItem } from "./item";

export type PublicLocation = {
  ownerId: string;
  locationId: string;
  areaName: string;
  locationName: string;
  labelName?: string;
  isPublic: boolean;
  items: PublicItem[];
  updatedAt?: unknown;
};
