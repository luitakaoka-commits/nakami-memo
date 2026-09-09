"use client";

import { useCallback } from "react";
import type { Location } from "@/lib/types/location";
import { locationsQuery, snapToLocation } from "@/lib/firebase/firestore";
import { sortLocations } from "@/lib/utils/inventory";
import { useCollection } from "./useCollection";

export function useLocations(userId?: string) {
  const buildQuery = useCallback(() => (userId ? locationsQuery(userId) : null), [userId]);
  const { data, loading, error } = useCollection<Location>(buildQuery, snapToLocation, sortLocations);
  return { locations: data, loading, error };
}
