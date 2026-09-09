"use client";

import { useCallback } from "react";
import type { Area } from "@/lib/types/area";
import { areasQuery, snapToArea } from "@/lib/firebase/firestore";
import { sortAreas } from "@/lib/utils/inventory";
import { useCollection } from "./useCollection";

export function useAreas(userId?: string) {
  const buildQuery = useCallback(() => (userId ? areasQuery(userId) : null), [userId]);
  const { data, loading, error } = useCollection<Area>(buildQuery, snapToArea, sortAreas);
  return { areas: data, loading, error };
}
