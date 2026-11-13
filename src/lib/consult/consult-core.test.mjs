/* 相談AIの、ネットワークを使わない部分の確認（2026-11-13）。
 * 実行: node --experimental-strip-types src/lib/consult/consult-core.test.mjs（npm test から呼ばれる）
 */
import {
  MAX_HISTORY_CHARS, MAX_MESSAGE_CHARS, MAX_TURNS, buildSystemInstruction, createConsultThrottle, isExpiredThread,
  normalizeConsultRequest, parseGeminiSse, threadTitleFrom, toGeminiContents,
} from "./consult-core.ts";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("失敗 " + name + "  →  " + (e.message || e)); }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: 期待 ${b} / 実際 ${a}`);
}
function ok(cond, label) { if (!cond) throw new Error(label); }

t("相談の受け取り：空の文・知らない役・長すぎる文・知らない記録名をそろえる", () => {
  const r = normalizeConsultRequest({
    messages: [{ role: "assistant", text: "こんにちは" }, { role: "x", text: "  " }, { role: "user", text: "a".repeat(MAX_MESSAGE_CHARS + 10) }],
    context: "お金: 10円", sources: ["お金管理", "勝手な記録", "お金管理"], today: "2026-11-13",
  });
  eq(r.messages.map((m) => [m.role, m.text.length]), [["assistant", 5], ["user", MAX_MESSAGE_CHARS]], "会話");
  eq(r.sources, ["お金管理"], "記録名");
  eq(r.today, "2026-11-13", "今日");
});

t("最後が本人の文でない・文が無い相談は受け付けない", () => {
  let threw = 0;
  for (const body of [{}, { messages: [] }, { messages: [{ role: "assistant", text: "x" }] }]) {
    try { normalizeConsultRequest(body); } catch { threw++; }
  }
  eq(threw, 3, "拒否");
});

t("AIに渡す会話：本人から始まり、交互にそろえ、新しいほうから上限まで残す", () => {
  const contents = toGeminiContents([
    { role: "assistant", text: "最初の挨拶" }, { role: "user", text: "A" }, { role: "user", text: "B" }, { role: "assistant", text: "C" }, { role: "user", text: "D" },
  ]);
  eq(contents.map((c) => [c.role, c.parts[0].text]), [["user", "A\n\nB"], ["model", "C"], ["user", "D"]], "交互");
  const many = Array.from({ length: MAX_TURNS + 10 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `m${i}` }));
  many.push({ role: "user", text: "最後" });
  ok(toGeminiContents(many).length <= MAX_TURNS, "回数の上限");
  const long = [{ role: "user", text: "x".repeat(MAX_HISTORY_CHARS) }, { role: "assistant", text: "y" }, { role: "user", text: "新しい質問" }];
  eq(toGeminiContents(long).map((c) => c.parts[0].text), ["新しい質問"], "文字数の上限で古いほうを落とす（先頭が model なら落とす）");
});

t("AIへの前提：記録の数字だけを根拠にする・予定の収入を数えない・記録を書き換えない、と伝える", () => {
  const s = buildSystemInstruction("【お金】使える額 10,000円", "2026-11-13", ["お金管理"]);
  for (const phrase of ["書かれていない数字を作らない", "予定の収入", "書き換えることはできない", "2026-11-13", "使える額 10,000円", "参考にできる記録】お金管理"]) {
    ok(s.includes(phrase), `「${phrase}」が無い`);
  }
  ok(buildSystemInstruction("", "", []).includes("記録を読めませんでした"), "記録が無いときはそう伝える");
});

t("Gemini の流れる返答（SSE）を、途中で切れても読める", () => {
  const event = (text, extra = {}) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...extra }] })}\n\n`;
  const full = event("こん") + event("にちは") + 'data: {"candidates":[{"content":{"parts":[{"text":"考え中","thought":true}]}}]}\n\n';
  const first = parseGeminiSse(full.slice(0, 30));
  eq(first.texts, [], "途中ならまだ出さない");
  const all = parseGeminiSse(first.rest + full.slice(30));
  eq(all.texts, ["こん", "にちは"], "考えている途中（thought）は出さない");
  eq(all.rest, "", "残り");
  eq(parseGeminiSse(event("x", { finishReason: "SAFETY" })).blocked, "SAFETY", "安全上止まった");
  eq(parseGeminiSse("data: {壊れた}\n\n" + event("ok")).texts, ["ok"], "壊れた1件は飛ばす");
  eq(parseGeminiSse(event("a").replace(/\n/g, "\r\n")).texts, ["a"], "改行が CRLF でも読む");
});

t("相談の名前は最初の文から（長ければ縮める）", () => {
  eq(threadTitleFrom("  今月あといくら使える？ "), "今月あといくら使える？", "そのまま");
  eq(threadTitleFrom("あ".repeat(30)), "あ".repeat(24) + "…", "縮める");
  eq(threadTitleFrom(""), "新しい相談", "空");
});

t("30日使っていない相談だけが自動整理の対象", () => {
  const now = Date.parse("2026-11-13T00:00:00Z");
  eq(isExpiredThread(now - 31 * 86_400_000, now), true, "31日前");
  eq(isExpiredThread(now - 29 * 86_400_000, now), false, "29日前");
  eq(isExpiredThread(0, now), false, "日時が無いものは消さない");
});

t("回数の制限（連打よけ）", () => {
  const allow = createConsultThrottle(2, 1000);
  eq([allow("u", 0), allow("u", 10), allow("u", 20), allow("v", 20), allow("u", 1500)], [true, true, false, true, true], "1秒2回");
});

/* ---------- 画面側（public/consult/）の部品 ---------- */
const screen = await import("../../../public/consult/chat-format.js");
const context = await import("../../../public/consult/context-format.js");

t("画面の「相談の名前」「30日の自動整理」は、サーバー側と同じ決まり", () => {
  for (const sample of ["", "  短い ", "あ".repeat(30), "改行\nあり"]) eq(screen.threadTitleFrom(sample), threadTitleFrom(sample), `名前: ${sample}`);
  const now = Date.parse("2026-11-13T00:00:00Z");
  for (const days of [0, 29, 30.5, 31, 400]) eq(screen.isExpiredThread(now - days * 86_400_000, now), isExpiredThread(now - days * 86_400_000, now), `${days}日前`);
});

t("返答の表示：必ずエスケープし、段落・箇条書き・太字だけを整える（リンクや画像は作らない）", () => {
  const html = screen.renderAnswer("結論です。\n\n- **食費** を見直す\n- 2つ目\n\n1. 手順\n<img src=x onerror=alert(1)> [リンク](https://example.com)");
  ok(html.includes("<p>結論です。</p>"), "段落");
  ok(html.includes("<ul><li><strong>食費</strong> を見直す</li><li>2つ目</li></ul>"), "箇条書きと太字");
  ok(html.includes("<ol><li>手順</li></ol>"), "番号付き");
  ok(html.includes("&lt;img") && !html.includes("<img") && !html.includes("<a "), "HTMLをそのまま出さない");
});

t("記録の要約（お金）：口座・使える額・これからの支払い（カード名つき）・予定の収入・今月の収支", () => {
  const text = context.formatMoney({
    today: "2026-11-13", monthLabel: "11月",
    state: { accounts: [{ id: "bank", name: "三菱UFJ", currentBalance: 120000, isPrimary: true, balanceEvidence: { date: "2026-11-12" } }], cards: [{ id: "smbc", name: "SMBC" }], recurringPlans: [{ name: "通信費", amount: 3300 }] },
    view: {
      period: { deadline: "2026-11-15" }, allowance: { amount: 25000, endDate: "2026-12-10", reserve: 10000 },
      scenario: { events: [
        { status: "planned", date: "2026-12-10", kind: "expense", cardPayment: true, cardId: "smbc", amount: 82232, additionalPossible: 1500, amountConfirmed: false, accountId: "bank" },
        { status: "planned", date: "2026-11-25", kind: "income", amount: 78000, accountId: "bank" },
        { status: "planned", date: "2026-11-01", kind: "expense", amount: 999, accountId: "bank" },
      ] },
    },
    summary: { income: { total: 55000 }, expense: { total: 4780, categories: [{ label: "食費", amount: 2980 }] }, saving: { total: 0 } },
  });
  for (const phrase of ["三菱UFJ: 120,000円", "2026-11-12に銀行で確認", "2026-11-15までに 25,000円", "2026-12-10 SMBCの引落（請求額は未確認）: 83,732円（うち請求額に未反映の利用 1,500円）", "予定の収入（まだ入っていない。使える額には数えない）", "2026-11-25: 78,000円", "11月の確定した収支: 収入 55,000円、支出 4,780円", "食費 2,980円", "通信費 3,300円"]) {
    ok(text.includes(phrase), `「${phrase}」が無い\n${text}`);
  }
  ok(!text.includes("999円"), "過ぎた予定は入れない");
});

t("記録の要約（在庫・レシピ・からだの記録）", () => {
  const stock = context.formatInventory([
    { name: "牛乳", quantity: 1, unit: "本", category: "飲料", expiration: "2026-11-14", location: "冷蔵庫" },
    { name: "米", quantity: 2, unit: "kg", category: "食品", expiration: "" },
    { name: "使い切り", quantity: 0, unit: "個" },
    { name: "豆腐", quantity: 1, unit: "丁", category: "食品", expiration: "2026-11-10" },
  ], "2026-11-13");
  ok(stock.includes("2件") === false && stock.includes("3件"), `件数（0個は数えない）\n${stock}`);
  ok(stock.indexOf("豆腐") < stock.indexOf("牛乳") && stock.indexOf("牛乳") < stock.indexOf("米"), "期限が近い順");
  ok(stock.includes("期限切れ 2026-11-10") && stock.includes("冷蔵庫"), "期限切れと場所");
  const recipes = context.formatRecipes({
    recipes: [{ title: "肉じゃが", category: "主菜", lastCookedAt: Date.parse("2026-11-01T03:00:00Z") }],
    plans: [{ date: "2026-11-14", slot: "夕食", titles: ["肉じゃが"] }, { date: "2026-11-01", slot: "夕食", titles: ["過去"] }],
    shopping: [{ name: "にんじん", done: false }, { name: "買った", done: true }],
  }, "2026-11-13");
  ok(recipes.includes("肉じゃが（主菜、最後に作った日 2026-11-01）") && recipes.includes("2026-11-14 夕食「肉じゃが」") && !recipes.includes("過去"), `レシピと献立\n${recipes}`);
  ok(recipes.includes("にんじん") && !recipes.includes("買った"), "買い物リストは未購入だけ");
  const health = context.formatHealth([{ metric: "sleepScore", values: { "2026-11-12": 70, "2026-11-13": 80, "2026-11-20": 99 } }, { metric: "unknown", values: { "2026-11-13": 1 } }], "2026-11-13");
  ok(health.includes("睡眠スコア: 最新 80（2026-11-13）、直近2回の平均 75") && !health.includes("99") && !health.includes("unknown"), `からだの記録\n${health}`);
  eq(context.formatHealth([], "2026-11-13"), "", "記録が無ければ何も出さない");
  ok(context.HEALTH_LABELS.sleepScore === "睡眠スコア", "項目名");
});

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
