"use client";

import { useCallback } from "react";
import { savedRecipesQuery, snapToSavedRecipe } from "@/lib/firebase/kitchen";
import type { SavedRecipe } from "@/lib/types/recipe";
import { useCollection } from "./useCollection";

/** つくりおきノートに保存されたレシピ。なかみメモでは履歴として見せるだけ。 */
export function useSavedRecipes(userId?: string) {
  const buildQuery = useCallback(() => (userId ? savedRecipesQuery(userId) : null), [userId]);
  const { data, loading, error } = useCollection<SavedRecipe>(buildQuery, snapToSavedRecipe);
  return { recipes: data, loading, error };
}
