/* 相談AIに渡す「本人の記録」の要約を作る（ネットワークを使わない部分。2026-11-13）。
 * 読み込みは context.js、ここは文章にするだけ。Node から直接テストする（tests/context-format.test.mjs）。
 * 数字は記録どおりに書き、推測で補わない（AIにも「書かれていない数字を作らない」と伝えている）。 */

export const yen = (value) => `${Math.round(Number(value) || 0) < 0 ? "-" : ""}${Math.abs(Math.round(Number(value) || 0)).toLocaleString("ja-JP")}円`;
const clip = (value, max) => { const text = String(value ?? "").replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max)}…` : text; };
const day = (value) => /^\d{4}-\d{2}-\d{2}/.test(String(value || "")) ? String(value).slice(0, 10) : "";

/**
 * お金管理。view は daily-finance.js の overview の結果（読めなければ null）、state は家計の記録。
 * cards はカード一覧（引落の行にカード名を出すため）。summary は今月の収支（FinanceEngine.summarizePeriod）。
 */
export function formatMoney({ state, view, summary, today, monthLabel }) {
  if (!state) return "";
  const lines = ["【お金管理】"];
  const cards = new Map((state.cards || []).map((card) => [card.id, card]));
  const accounts = new Map((state.accounts || []).map((account) => [account.id, account]));
  lines.push("口座（登録した残高）:");
  for (const account of state.accounts || []) {
    const verified = account.balanceEvidence?.date ? `、${account.balanceEvidence.date}に銀行で確認` : "、銀行の残高は未確認";
    lines.push(`- ${clip(account.name, 30)}: ${yen(account.currentBalance)}（${account.isPrimary || account.role === "primary" ? "基準口座" : "サブ口座"}${verified}）`);
  }
  if (view?.allowance) {
    lines.push(`使える額の目安: ${view.period?.deadline || "締め日"}までに ${yen(view.allowance.amount)}（基準口座の残高から、${view.allowance.endDate || ""}までの支払いと予備額 ${yen(view.allowance.reserve)} を引いた額。予定の収入は含まない）`);
  }
  const events = (view?.scenario?.events || [])
    .filter((event) => event.status === "planned" && event.date >= today && event.kind !== "income")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 20);
  if (events.length) {
    lines.push("これからの支払い（近い順）:");
    for (const event of events) {
      const label = event.cardPayment
        ? `${clip(cards.get(event.cardId)?.name || "カード", 20)}の引落${event.amountConfirmed ? "（請求額を確認済み）" : "（請求額は未確認）"}`
        : "支払い";
      const extra = event.additionalPossible ? `（うち請求額に未反映の利用 ${yen(event.additionalPossible)}）` : "";
      lines.push(`- ${event.date} ${label}: ${yen((event.amount || 0) + (event.additionalPossible || 0))}${extra}、${clip(accounts.get(event.accountId)?.name || "", 20)}から`);
    }
  }
  const incomes = (view?.scenario?.events || [])
    .filter((event) => event.status === "planned" && event.date >= today && event.kind === "income")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);
  if (incomes.length) {
    lines.push("予定の収入（まだ入っていない。使える額には数えない）:");
    for (const event of incomes) lines.push(`- ${event.date}: ${yen(event.amount)}`);
  }
  if (summary) {
    lines.push(`${monthLabel || "今月"}の確定した収支: 収入 ${yen(summary.income?.total)}、支出 ${yen(summary.expense?.total)}（立替分を除いた実質負担）、貯蓄・投資 ${yen(summary.saving?.total)}`);
    const top = (summary.expense?.categories || []).slice(0, 6).map((item) => `${clip(item.label, 12)} ${yen(item.amount)}`);
    if (top.length) lines.push(`支出の内訳（多い順）: ${top.join("、")}`);
  }
  const plans = (state.recurringPlans || []).filter((plan) => plan && plan.active !== false && plan.isActive !== false).slice(0, 12);
  if (plans.length) lines.push(`定期支払い: ${plans.map((plan) => `${clip(plan.name || plan.memo || "定期", 14)} ${yen(plan.amount)}`).join("、")}`);
  return lines.join("\n");
}

/** なかみメモの在庫。items は { name, quantity, unit, category, expiration('YYYY-MM-DD' or ''), location } */
export function formatInventory(items, today) {
  if (!Array.isArray(items)) return "";
  const rows = items.filter((item) => item && item.name && Number(item.quantity) > 0);
  if (!rows.length) return "【なかみメモの在庫】\n（在庫なし）";
  const sorted = rows.slice().sort((a, b) => (a.expiration || "9999").localeCompare(b.expiration || "9999") || String(a.name).localeCompare(String(b.name), "ja"));
  const lines = [`【なかみメモの在庫】${rows.length}件（期限が近い順）`];
  for (const item of sorted.slice(0, 120)) {
    const expiry = item.expiration ? (item.expiration < today ? `期限切れ ${item.expiration}` : `期限 ${item.expiration}`) : "期限なし";
    lines.push(`- ${clip(item.name, 30)} ${Number(item.quantity)}${clip(item.unit, 6)}（${clip(item.category || "未分類", 8)}、${expiry}${item.location ? `、${clip(item.location, 12)}` : ""}）`);
  }
  if (sorted.length > 120) lines.push(`ほか ${sorted.length - 120}件`);
  return lines.join("\n");
}

/** つくりおきノート。recipes は { title, category, lastCookedAt }、plans は { date, slot, titles }、shopping は { name, done } */
export function formatRecipes({ recipes = [], plans = [], shopping = [] }, today) {
  const lines = ["【つくりおきノート】"];
  if (recipes.length) {
    lines.push(`保存したレシピ ${recipes.length}件: ${recipes.slice(0, 60).map((recipe) => `${clip(recipe.title, 20)}（${clip(recipe.category, 6)}${recipe.lastCookedAt ? `、最後に作った日 ${day(new Date(recipe.lastCookedAt).toISOString())}` : ""}）`).join("、")}`);
  } else lines.push("保存したレシピ: なし");
  const upcoming = plans.filter((plan) => plan.date >= today).sort((a, b) => a.date.localeCompare(b.date) || String(a.slot).localeCompare(String(b.slot), "ja")).slice(0, 14);
  if (upcoming.length) lines.push(`これからの献立: ${upcoming.map((plan) => `${plan.date} ${plan.slot}「${plan.titles.map((title) => clip(title, 16)).join("・") || "未定"}」`).join("、")}`);
  const toBuy = shopping.filter((item) => item.name && !item.done).slice(0, 40);
  lines.push(toBuy.length ? `買い物リスト（未購入）: ${toBuy.map((item) => clip(item.name, 16)).join("、")}` : "買い物リスト（未購入）: なし");
  return lines.join("\n");
}

/** からだの記録の項目名（なかみメモの src/lib/health/samsung-core.ts と同じ並び・名前） */
export const HEALTH_LABELS = {
  antioxidant: "抗酸化指数", ages: "AGEs指数", agesPercent: "AGEs（同年代での位置%）", vascularLoad: "血管負荷（基準との差、大きいほど高い）",
  bodyWater: "体水分量(kg)", weight: "体重(kg)", waterIntake: "飲んだ水(mL)", vitality: "エナジースコア", vitalitySleep: "エナジースコア（睡眠）",
  vitalityActivity: "エナジースコア（活動）", sleepScore: "睡眠スコア", stress: "ストレス", steps: "歩数", heartHealth: "心臓の健康スコア",
};

/** docs は users/{uid}/health の月ごとの記録 { metric, values: { 'YYYY-MM-DD': 数 } } */
export function formatHealth(docs, today) {
  if (!Array.isArray(docs) || !docs.length) return "";
  const series = new Map();
  for (const doc of docs) {
    if (!HEALTH_LABELS[doc?.metric] || !doc.values || typeof doc.values !== "object") continue;
    const daily = series.get(doc.metric) || {};
    for (const [date, value] of Object.entries(doc.values)) if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today && Number.isFinite(Number(value))) daily[date] = Number(value);
    series.set(doc.metric, daily);
  }
  const lines = ["【からだの記録（Samsung Health）】医療的な判断には使わない。料理や暮らしの選び方の参考"];
  for (const [metric, label] of Object.entries(HEALTH_LABELS)) {
    const daily = series.get(metric);
    const dates = Object.keys(daily || {}).sort();
    if (!dates.length) continue;
    const recent = dates.slice(-7).map((date) => daily[date]);
    const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    lines.push(`- ${label}: 最新 ${daily[dates[dates.length - 1]]}（${dates[dates.length - 1]}）、直近${recent.length}回の平均 ${Math.round(average * 10) / 10}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}
