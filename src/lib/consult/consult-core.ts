/**
 * 相談AI（くらしノートの4つ目。2026-11-13 ユーザー要望）の、ネットワークを使わない部分。
 *
 * 形は「ことのはの鏡」の相談チャットにならう：相談（スレッド）をいくつでも作れ、名前の変更・削除、30日で自動整理、
 * 返答は少しずつ流れて途中で止められる、返答ごとに何の記録を参考にしたかが分かる。
 *
 * 記録（お金・在庫・レシピ・からだの記録）は画面側が本人の権限で読んで要約し、ここで AI への指示に入れる。
 * サーバー（src/app/api/consult/route.ts）と画面（public/consult/）の両方の約束をここに置き、Node から直接テストする
 * （consult-core.test.mjs。node --experimental-strip-types）。そのため型以外を import しない。
 */

/** 1回の相談で AI に渡す会話の上限（古い順に落とす） */
export const MAX_TURNS = 24;
/** 会話の文字数の上限（古い順に落とす）。無料枠と待ち時間を守るため */
export const MAX_HISTORY_CHARS = 24_000;
/** 1通の上限 */
export const MAX_MESSAGE_CHARS = 4_000;
/** 記録の要約の上限 */
export const MAX_CONTEXT_CHARS = 30_000;
/** 使われていない相談を自動で消すまでの日数（ことのはの鏡と同じ） */
export const RETENTION_DAYS = 30;

export type ConsultRole = "user" | "assistant";
export type ConsultMessage = { role: ConsultRole; text: string };
export type ConsultRequest = { messages: ConsultMessage[]; context: string; sources: string[]; today: string };

/** 記録の種類（返答の下に「参考にした記録」として出す） */
export const CONSULT_SOURCES = ["お金管理", "なかみメモの在庫", "つくりおきノート", "からだの記録"] as const;

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** 画面から来た相談を、安全な形にそろえる。おかしなものは Error */
export function normalizeConsultRequest(raw: unknown): ConsultRequest {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(body.messages) ? body.messages : [];
  const messages = list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", text: text(item.text).trim().slice(0, MAX_MESSAGE_CHARS) }) as ConsultMessage)
    .filter((item) => item.text);
  if (!messages.length || messages[messages.length - 1].role !== "user") throw new Error("相談の文が空です。");
  const sources = (Array.isArray(body.sources) ? body.sources : []).filter((name): name is string => (CONSULT_SOURCES as readonly string[]).includes(String(name)));
  const today = /^\d{4}-\d{2}-\d{2}$/.test(text(body.today)) ? text(body.today) : "";
  return { messages, context: text(body.context).slice(0, MAX_CONTEXT_CHARS), sources: [...new Set(sources)], today };
}

/**
 * AI に渡す会話。新しいほうから上限まで残す。Gemini は user と model が交互で、user から始まる必要があるので、
 * 同じ役が続いたらつなぎ、先頭が model なら落とす。
 */
export function toGeminiContents(messages: ConsultMessage[]) {
  const kept: ConsultMessage[] = [];
  let chars = 0;
  for (let index = messages.length - 1; index >= 0 && kept.length < MAX_TURNS; index -= 1) {
    const message = messages[index];
    if (kept.length && chars + message.text.length > MAX_HISTORY_CHARS) break;
    kept.unshift(message);
    chars += message.text.length;
  }
  const merged: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  for (const message of kept) {
    const role = message.role === "assistant" ? "model" : "user";
    const last = merged[merged.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n\n${message.text}`;
    else merged.push({ role, parts: [{ text: message.text }] });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  return merged;
}

/** AI への前提（役割・守ること・記録の要約） */
export function buildSystemInstruction(context: string, today: string, sources: string[]): string {
  return [
    "あなたは「くらしノート」の相談役です。くらしノートは、お金管理・なかみメモ（家の在庫）・つくりおきノート（料理）を1つにまとめた、本人のための家計と暮らしのアプリです。",
    "目的は「食費・日用品の無駄な出費を減らすこと」と「次のカード引落を確実に払えること」です。",
    "",
    "【答え方】",
    "- 日本語で、短く具体的に答える。まず結論、次に理由、必要なら次の一歩。",
    "- 下の【本人の記録】に書かれている数字だけを根拠にし、書かれていない数字を作らない。分からないことは分からないと言う。",
    "- 金額は記録どおりに書く（例: 12,345円）。計算したときは、何から何を引いたかを書く。",
    "- 予定の収入（給料の見込みなど）は、入るまで使える額として数えない。",
    "- 投資・保険・ローンなどの個別の金融商品を勧めない。医療的な判断はせず、心配があれば専門家に相談するよう伝える。",
    "- 記録を書き換えることはできない。直したほうがよい記録があれば、どのアプリのどこで直せるかを伝える。",
    "",
    `【今日】${today || "不明"}`,
    `【参考にできる記録】${sources.length ? sources.join("、") : "なし（記録を読めませんでした）"}`,
    "",
    "【本人の記録】",
    context || "（記録を読めませんでした。一般的な答えになることを伝える）",
  ].join("\n");
}

/**
 * Gemini の streamGenerateContent（alt=sse）の返答を読む。届いた分を渡すと、取り出せた文と、まだ途中の残りを返す。
 * 1行が `data: {...}` で、空行で区切られる。
 */
export function parseGeminiSse(buffer: string): { texts: string[]; rest: string; blocked: string } {
  const texts: string[] = [];
  let blocked = "";
  const normalized = buffer.replace(/\r\n/g, "\n");
  const events = normalized.split("\n\n");
  const rest = events.pop() ?? "";
  for (const event of events) {
    const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
        promptFeedback?: { blockReason?: string };
      };
      if (parsed.promptFeedback?.blockReason) blocked = parsed.promptFeedback.blockReason;
      for (const candidate of parsed.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) if (part.text && !part.thought) texts.push(part.text);
        if (candidate.finishReason === "SAFETY") blocked = "SAFETY";
      }
    } catch {
      /* 壊れた1件は飛ばす */
    }
  }
  return { texts, rest, blocked };
}

/** 最初の相談の文から、相談の名前を決める（あとで変えられる） */
export function threadTitleFrom(firstMessage: string): string {
  const line = firstMessage.replace(/\s+/g, " ").trim();
  if (!line) return "新しい相談";
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

/** 30日使っていない相談か（自動整理の対象） */
export function isExpiredThread(updatedAtMillis: number, nowMillis: number, days = RETENTION_DAYS): boolean {
  return Number.isFinite(updatedAtMillis) && updatedAtMillis > 0 && nowMillis - updatedAtMillis > days * 86_400_000;
}

/** 回数の制限（1人1分 N 回）。サーバーのメモリなので、インスタンスをまたぐと効かない。連打よけ */
export function createConsultThrottle(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now: number) => {
    const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) { hits.set(key, recent); return false; }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}
