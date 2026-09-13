import { NextResponse } from "next/server";
import { firebaseConfig } from "@/lib/firebase/config";
import {
  buildPrompt,
  createThrottle,
  documentsToObjects,
  normalizeOptions,
  normalizeTools,
  pickPantry,
  responseSchema,
  sanitizeSuggestions,
} from "@/lib/recipes/suggest-core";

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

// 2026-09 に gemini-2.5-flash が新規ユーザーに閉じられた。レシート取込（GAS）と同じモデルにそろえる。
// Gemini 3 系は temperature を既定のまま使う前提なので指定しない。
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_TIMEOUT_MS = 50_000;

// 連打よけ（1人1分5回）。無料枠を1回の連打で使い切らないため。
const allow = createThrottle(5, 60_000);

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function verifyUser(request: Request): Promise<{ uid: string; idToken: string }> {
  const authorization = request.headers.get("authorization");
  const idToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!idToken) throw new ApiError("ログイン情報を確認できませんでした。", 401);

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
    cache: "no-store",
  });
  if (!response.ok) throw new ApiError("ログインの有効期限が切れています。再読み込みしてください。", 401);
  const data = (await response.json()) as { users?: Array<{ localId?: string }> };
  const uid = data.users?.[0]?.localId;
  if (!uid) throw new ApiError("ユーザーを確認できませんでした。", 401);
  return { uid, idToken };
}

/** users/{uid}/{name} を全部読む（本人の ID トークンで。ルールが効く）。 */
async function readUserCollection(uid: string, idToken: string, name: string) {
  const base = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}/${name}`;
  const all: Array<Record<string, unknown> & { id: string }> = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const url = `${base}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` }, cache: "no-store" });
    if (!response.ok) {
      console.error(`[api/recipes/suggest] ${name} を読めません`, response.status, (await response.text()).slice(0, 300));
      throw new ApiError("在庫を読み取れませんでした。再読み込みしてからお試しください。", 502);
    }
    const body = (await response.json()) as { documents?: Array<{ name?: string; fields?: Record<string, Record<string, unknown>> }>; nextPageToken?: string };
    all.push(...documentsToObjects(body.documents ?? []));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return all;
}

async function askGemini(prompt: string): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ApiError("レシピ提案の設定がまだです（サーバーに GEMINI_API_KEY がありません）。", 500);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: responseSchema() },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new ApiError("AIの返事が時間内に届きませんでした。もう一度お試しください。", 504);
    throw new ApiError("AIに接続できませんでした。", 502);
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await response.text();
  if (!response.ok) {
    console.error("[api/recipes/suggest] Gemini がエラーを返しました", response.status, bodyText.slice(0, 500));
    if (response.status === 429) throw new ApiError("AIの無料枠を使い切りました。しばらく（翌日まで）待ってからお試しください。", 429);
    if (response.status === 404) throw new ApiError("AIのモデルが使えなくなっています。設定の見直しが必要です。", 502);
    throw new ApiError("AIがエラーを返しました。時間をおいてお試しください。", 502);
  }

  try {
    const parsed = JSON.parse(bodyText) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = parsed.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    return JSON.parse(text);
  } catch {
    console.error("[api/recipes/suggest] Gemini の返答を読めません", bodyText.slice(0, 500));
    throw new ApiError("AIの返事を読み取れませんでした。もう一度お試しください。", 502);
  }
}

export async function POST(request: Request) {
  try {
    const { uid, idToken } = await verifyUser(request);
    if (!allow(uid, Date.now())) throw new ApiError("続けて使いすぎです。1分ほど待ってからお試しください。", 429);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const [rawItems, rawTools] = await Promise.all([
      readUserCollection(uid, idToken, "items"),
      readUserCollection(uid, idToken, "tools"),
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
    const raw = await askGemini(buildPrompt(pantry, tools, options));
    const result = sanitizeSuggestions(raw, pantry, tools, options);
    if (!result.recipes.length) throw new ApiError("条件に合うレシピを作れませんでした。条件をゆるめてお試しください。", 422);

    return NextResponse.json({ ...result, assumedBasicTools: tools.length === 0 });
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[api/recipes/suggest] 想定外のエラー", error);
    return NextResponse.json({ error: "レシピを提案できませんでした。" }, { status: 500 });
  }
}
