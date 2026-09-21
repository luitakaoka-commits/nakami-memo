"use client";

import type { User } from "firebase/auth";
import type { RecipeSuggestion, SuggestOptions } from "./suggest-core";

export type SuggestResponse = {
  recipes: RecipeSuggestion[];
  uncoveredMustUse: string[];
  assumedBasicTools: boolean;
  /** 混雑などで予備のモデルが答えたときのモデル名。本来のモデルなら空（2026-09-22） */
  fallbackModel?: string;
};

/** /api/recipes/suggest を呼ぶ。失敗したら画面に出せる日本語のメッセージで Error を投げる。 */
export async function requestSuggestions(user: User, options: SuggestOptions): Promise<SuggestResponse> {
  const idToken = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch("/api/recipes/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(options),
    });
  } catch {
    throw new Error("通信できませんでした。電波の良いところでお試しください。");
  }
  const data = (await response.json().catch(() => ({}))) as Partial<SuggestResponse> & { error?: string };
  if (!response.ok) throw new Error(data.error || "レシピを提案できませんでした。");
  return { recipes: data.recipes ?? [], uncoveredMustUse: data.uncoveredMustUse ?? [], assumedBasicTools: Boolean(data.assumedBasicTools), fallbackModel: String(data.fallbackModel ?? "") };
}
