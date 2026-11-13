import { NextResponse } from "next/server";
import { spaceSegments } from "@/lib/household/household-core";
import { healthHints, healthPromptLines, japanDate } from "@/lib/health/health-hints";
import { seriesFromDocs } from "@/lib/health/samsung-core";
import {
  buildPrompt,
  createThrottle,
  normalizeOptions,
  normalizeTools,
  pickPantry,
  responseSchema,
  sanitizeSuggestions,
} from "@/lib/recipes/suggest-core";
import { ApiError, GEMINI_MODEL, askGemini, readUserCollection, spaceBase, verifyUser } from "@/lib/server/ai-server";

/**
 * POST /api/recipes/suggest — 在庫と調理器具からレシピを提案する（Phase 3）。
 *
 * - Gemini のキーはサーバーの環境変数 GEMINI_API_KEY だけに置く。ブラウザには出さない
 * - ログインの確認は ID トークンを identitytoolkit で照合する（画像APIと同じ。鍵ファイル不要）
 * - 在庫と器具は、ブラウザから送らせず、同じ ID トークンで Firestore REST から読む。
 *   セキュリティルールに従ったまま本人のデータだけが読め、改ざんの余地もない
 * - AI の返答はそのまま返さず、suggest-core の sanitizeSuggestions で在庫・器具と突き合わせる
 */

// Gemini 3 系は考えてから答えるので、数十秒かかることがある
export const maxDuration = 60;

// 連打よけ（1人1分5回）。無料枠を1回の連打で使い切らないため。
const allow = createThrottle(5, 60_000);

export async function POST(request: Request) {
  try {
    const { uid, idToken } = await verifyUser(request);
    if (!allow(uid, Date.now())) throw new ApiError("続けて使いすぎです。1分ほど待ってからお試しください。", 429);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const space = await spaceBase(uid, idToken);
    const [rawItems, rawTools] = await Promise.all([
      readUserCollection(uid, idToken, "items", space),
      readUserCollection(uid, idToken, "tools", space),
    ]);

    const pantry = pickPantry(
      rawItems.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category,
        expirationMillis: typeof item.expirationDate === "number" ? item.expirationDate : null,
      })),
      Date.now(),
    );
    if (!pantry.length) {
      throw new ApiError("使える食材がありません。カテゴリが「食品」「飲料」「調味料」で、数量が1以上の在庫が要ります。", 400);
    }

    const tools = normalizeTools(rawTools);
    const options = normalizeOptions(body, pantry);
    // からだの記録（Samsung Health から取り込んだ値）。健康データなので家ではなく本人の場所から読む（2026-09-28）。
    // 読めなくてもレシピは出す（記録を使わないだけ）
    const hints = options.useHealth
      ? healthHints(seriesFromDocs(await readUserCollection(uid, idToken, "health", spaceSegments(uid, null).map(encodeURIComponent).join("/")).catch(() => [])), japanDate(Date.now()))
      : [];
    const answer = await askGemini(buildPrompt(pantry, tools, options, healthPromptLines(hints)), responseSchema());
    const result = sanitizeSuggestions(answer.data, pantry, tools, options);
    if (!result.recipes.length) throw new ApiError("条件に合うレシピを作れませんでした。条件をゆるめてお試しください。", 422);

    // 予備のモデルで答えたときは、画面にそう出す（いつもと出来が違って見えたときの手がかり）
    return NextResponse.json({
      ...result,
      assumedBasicTools: tools.length === 0,
      // 何を理由にどんな希望を出したか（画面に出す）
      healthHints: hints.map((hint) => ({ key: hint.key, reason: hint.reason, instruction: hint.instruction })),
      fallbackModel: answer.model === GEMINI_MODEL ? "" : answer.model,
    });
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[api/recipes/suggest] 想定外のエラー", error);
    return NextResponse.json({ error: "レシピを提案できませんでした。" }, { status: 500 });
  }
}
