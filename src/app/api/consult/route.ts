import { firebaseConfig } from "@/lib/firebase/config";
import {
  buildSystemInstruction,
  createConsultThrottle,
  normalizeConsultRequest,
  parseGeminiSse,
  toGeminiContents,
} from "@/lib/consult/consult-core";
import {
  DEFAULT_GEMINI_FALLBACK_MODELS,
  geminiErrorDetail,
  geminiErrorMessage,
  geminiModelChain,
  nextGeminiStep,
  pickFallbackModels,
  triedModelsSummary,
} from "@/lib/recipes/suggest-core";

/**
 * POST /api/consult — くらしノートの相談AI（2026-11-13）。
 *
 * - Gemini のキーはサーバーの環境変数 GEMINI_API_KEY だけに置く（レシピ提案と同じ）
 * - ログインの確認は ID トークンを identitytoolkit で照合する（鍵ファイル不要）
 * - 記録の要約は画面（public/consult/）が本人の権限で Firestore から読んで作り、ここへ送る。
 *   ここではその要約を AI への前提に入れるだけで、保存も書き換えもしない
 * - 返答は Gemini の streamGenerateContent を読みながら、文字だけを少しずつ画面へ流す（text/plain）。
 *   混雑（5xx・429）のときは、流し始める前に1回やり直し、だめなら予備のモデルへ切り替える
 */

export const maxDuration = 60;

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const CONNECT_BUDGET_MS = 25_000;

// 連打よけ（1人1分10回）
const allow = createConsultThrottle(10, 60_000);

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

async function verifyUser(request: Request): Promise<string> {
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
  return uid;
}

async function listFallbackModels(apiKey: string): Promise<string[]> {
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": apiKey }, cache: "no-store" });
    if (!response.ok) throw new Error(`models.list ${response.status}`);
    const body = (await response.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    const picked = pickFallbackModels(body.models ?? [], GEMINI_MODEL);
    if (picked.length) return picked;
  } catch (error) {
    console.error("[api/consult] モデル一覧を取れません", error);
  }
  return [...DEFAULT_GEMINI_FALLBACK_MODELS];
}

/** 流し始められる返事（200）が来るまで、やり直し・予備への切り替えを行う */
async function openGeminiStream(payload: unknown, signal: AbortSignal): Promise<{ response: Response; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ApiError("相談AIの設定がまだです（サーバーに GEMINI_API_KEY がありません）。", 500);
  const configured = process.env.GEMINI_FALLBACK_MODELS;
  const models = geminiModelChain(GEMINI_MODEL, configured);
  let fallbacksLoaded = Boolean(configured);
  const deadline = Date.now() + CONNECT_BUDGET_MS;
  let modelIndex = 0;
  let attemptOnModel = 0;
  let lastFailure = { status: 0, detail: "" };
  const tried: Array<{ model: string; status: number }> = [];
  for (;;) {
    const model = models[modelIndex];
    let response: Response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(payload),
        signal,
        cache: "no-store",
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw new ApiError("止めました。", 499);
      throw new ApiError("AIに接続できませんでした。", 502);
    }
    if (response.ok && response.body) return { response, model };
    const bodyText = await response.text();
    console.error("[api/consult] Gemini がエラーを返しました", model, response.status, bodyText.slice(0, 500));
    tried.push({ model, status: response.status });
    if (!(response.status === 404 && lastFailure.status)) lastFailure = { status: response.status, detail: geminiErrorDetail(bodyText) };
    let step = nextGeminiStep({ modelCount: models.length, modelIndex, attemptOnModel, status: response.status, remainingMs: deadline - Date.now() });
    if (step.action === "stop" && !fallbacksLoaded && response.status !== 401 && response.status !== 403) {
      fallbacksLoaded = true;
      models.push(...(await listFallbackModels(apiKey)).filter((name) => !models.includes(name)));
      step = nextGeminiStep({ modelCount: models.length, modelIndex, attemptOnModel, status: response.status, remainingMs: deadline - Date.now() });
    }
    if (step.action === "stop") {
      const message = geminiErrorMessage(lastFailure.status)
        + (lastFailure.detail ? ` ／ Google の説明: ${lastFailure.detail}` : "")
        + (tried.length > 1 ? ` ／ 試したAI: ${triedModelsSummary(tried)}` : "");
      throw new ApiError(message, lastFailure.status === 429 ? 429 : 502);
    }
    attemptOnModel = step.modelIndex === modelIndex ? attemptOnModel + 1 : 0;
    modelIndex = step.modelIndex;
    if (step.waitMs) await new Promise((resolve) => setTimeout(resolve, step.waitMs));
  }
}

export async function POST(request: Request) {
  let opened: { response: Response; model: string };
  try {
    const uid = await verifyUser(request);
    if (!allow(uid, Date.now())) throw new ApiError("続けて使いすぎです。1分ほど待ってからお試しください。", 429);
    let consult;
    try {
      consult = normalizeConsultRequest(await request.json().catch(() => ({})));
    } catch (error) {
      throw new ApiError((error as Error).message, 400);
    }
    const payload = {
      systemInstruction: { parts: [{ text: buildSystemInstruction(consult.context, consult.today, consult.sources) }] },
      contents: toGeminiContents(consult.messages),
    };
    opened = await openGeminiStream(payload, request.signal);
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error.message, error.status);
    console.error("[api/consult] 想定外のエラー", error);
    return jsonError("相談できませんでした。", 500);
  }

  // Gemini の SSE から文字だけを取り出して流す。画面が止めたら（request.signal）Gemini との接続も切れる
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = opened.response.body!.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          const tail = parseGeminiSse(`${buffer}\n\n`);
          tail.texts.forEach((piece) => controller.enqueue(encoder.encode(piece)));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const { texts, rest, blocked } = parseGeminiSse(buffer);
        buffer = rest;
        texts.forEach((piece) => controller.enqueue(encoder.encode(piece)));
        if (blocked) {
          controller.enqueue(encoder.encode("\n\n（AIがこの内容には答えられないと判断しました。言い方を変えてお試しください）"));
          controller.close();
          await reader.cancel().catch(() => {});
          return;
        }
      }
    },
    async cancel() {
      await reader.cancel().catch(() => {});
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Consult-Model": opened.model,
      "X-Consult-Fallback": opened.model === GEMINI_MODEL ? "" : "1",
    },
  });
}
