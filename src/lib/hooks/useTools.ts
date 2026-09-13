"use client";

import { useCallback } from "react";
import { snapToTool, toolsQuery } from "@/lib/firebase/kitchen";
import type { Tool } from "@/lib/types/tool";
import { useCollection } from "./useCollection";

export function useTools(userId?: string) {
  const buildQuery = useCallback(() => (userId ? toolsQuery(userId) : null), [userId]);
  const { data, loading, error } = useCollection<Tool>(buildQuery, snapToTool);
  return { tools: data, loading, error };
}
