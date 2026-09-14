/**
 * つくりおきノートに保存されたレシピ（users/{uid}/recipes）。
 * 形はつくりおきノート（public/recipe/app.js の normalizeRecipe）が決めていて、なかみメモは読むだけ。
 * 日付はミリ秒の数値（Firestore の Timestamp ではない）。
 */
export type SavedRecipe = {
  id: string;
  title: string;
  category: string;
  servings: number;
  ingredients: string[];
  steps: string[];
  memo: string;
  /** 「AIの提案」なら、なかみメモのレシピ提案から保存したもの。 */
  source: string;
  createdAt: number;
  lastCookedAt: number;
};
