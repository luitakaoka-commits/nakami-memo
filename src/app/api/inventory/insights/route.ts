import { NextResponse } from "next/server";
import { spaceSegments } from "@/lib/household/household-core";
import { healthHints, healthPromptLines } from "@/lib/health/health-hints";
import { seriesFromDocs } from "@/lib/health/samsung-core";
import { createThrottle } from "@/lib/recipes/suggest-core";
import {
  FOOD_CATEGORIES, PRODUCT_LINKS, STOCK_EVENTS,
  buildInsightsPrompt, insightsSchema, japanDay, namesForMatching, nextBuys, sanitizeInsights,
  type ProductLink, type StockEvent,
} from "@/lib/inventory/stock-core";
import { ApiError, GEMINI_MODEL, askGemini, readUserCollection, spaceBase, verifyUser } from "@/lib/server/ai-server";

/**
 * POST /api/inventory/insights — 在庫AI（2026-11-14 ユーザー要望）。
 *
 * 在庫・使い切った記録・本人が決めた「同じ／別」を、本人の ID トークンで読み（ルールが効く）、Gemini に
 * 「同じ商品の候補」「栄養のかたより」「買うとよいもの」を考えさせる。返事は stock-core の sanitizeInsights で
 * 手元の品名と突き合わせてから返す。保存はしない（画面が本人の場所 users/{uid}/inventoryInsights に置く）。
 * 次の買い時の日付は AI に作らせず、記録から計算したものを前提として渡すだけ。
 */
export const maxDuration = 60;

// 連打よけ（1人1分3回）。ホームを開いたときに1日1回動く前提なので少なめ
const allow = createThrottle(3, 60_000);

const asString = (value: unknown) => (typeof value === "string" ? value : "");
const dayOf = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? japanDay(value) : null);

export async function POST(request: Request) {
  try {
    const { uid, idToken } = await verifyUser(request);
    if (!allow(uid, Date.now())) throw new ApiError("続けて使いすぎです。1分ほど待ってからお試しください。", 429);

    const space = await spaceBase(uid, idToken);
    const [rawItems, rawEvents, rawLinks] = await Promise.all([
      readUserCollection(uid, idToken, "items", space),
      readUserCollection(uid, idToken, STOCK_EVENTS, space).catch(() => []),
      readUserCollection(uid, idToken, PRODUCT_LINKS, space).catch(() => []),
    ]);
    const today = japanDay(Date.now());
    const items = rawItems
      .filter((item) => Number(item.quantity) > 0 && asString(item.name))
      .map((item) => ({
        id: item.id, name: asString(item.name), quantity: Number(item.quantity) || 0, unit: asString(item.unit), category: asString(item.category),
        since: dayOf(item.createdAt), remainingCheckedAt: asString(item.remainingCheckedAt) || null,
      }));
    const events = rawEvents as unknown as StockEvent[];
    const links: ProductLink[] = rawLinks.map((link) => ({ a: asString(link.a), b: asString(link.b), same: link.same === true }));
    if (!items.length && !events.length) throw new ApiError("在庫がまだありません。", 400);

    // 健康データは家ではなく本人の場所から読む（読めなければ使わないだけ）
    const health = await readUserCollection(uid, idToken, "health", spaceSegments(uid, null).map(encodeURIComponent).join("/")).catch(() => []);
    const healthLines = healthPromptLines(healthHints(seriesFromDocs(health), today));

    const names = namesForMatching([...items.map((item) => item.name), ...events.map((event) => event.name)], links);
    const foods = items.filter((item) => FOOD_CATEGORIES.includes(item.category)).slice(0, 120);
    const plan = nextBuys(items, events, links, today);
    const answer = await askGemini(buildInsightsPrompt({ names, foods, nextBuys: plan, healthLines, today }), insightsSchema());
    const insights = sanitizeInsights(answer.data, names, links);

    return NextResponse.json({
      ...insights,
      usedHealth: healthLines.length > 0,
      model: answer.model,
      fallbackModel: answer.model === GEMINI_MODEL ? "" : answer.model,
    });
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[api/inventory/insights] 想定外のエラー", error);
    return NextResponse.json({ error: "在庫AIが考えられませんでした。" }, { status: 500 });
  }
}
