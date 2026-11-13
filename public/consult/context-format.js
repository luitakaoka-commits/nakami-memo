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

const KIND_LABELS = { payment: "支払い", income: "収入", saving: "貯金", nisa: "NISA", reimbursement: "立替回収", transfer: "振込", adjustment: "残高調整" };
const STATUS_LABELS = { planned: "予定", settled: "確定", absorbed: "請求額の内訳", cancelled: "取消" };
const OUTCOME_LABELS = { in_stock: "まだある", consumed: "使い切った", wasted: "捨てた", partial: "一部捨てた", given: "あげた" };

/**
 * お金管理の記録を全部（2026-11-13 ユーザー要望「全てを見てほしい」）。
 * 口座・カード・設定・これからの予定（全件）・カードの請求（期間ごと）・月ごとの収支（全期間）・定期支払い・
 * シフト・レシートとムダ支出・メール取込の確認待ち・取引の記録（全件、新しい順）。
 * 文字数の上限（budget）を超えるときだけ、取引の記録の古いほうから省き、省いた件数を書く。
 *
 * cardGroups は FinanceEngine.groupCardCharges の結果、months は [{ month, summary }]（summarizePeriod）。
 */
export function formatMoneyDetails({ state, cardGroups = [], months = [], receipts = [], receiptItems = [], pendingMails = 0, today, budget = 150_000 }) {
  if (!state) return "";
  const cards = new Map((state.cards || []).map((card) => [card.id, card]));
  const accounts = new Map((state.accounts || []).map((account) => [account.id, account]));
  const cardName = (id) => clip(cards.get(id)?.name || "カード", 16);
  const accountName = (id) => clip(accounts.get(id)?.name || "", 16);
  const head = ["【お金管理の記録（全部）】"];

  head.push("口座の設定:");
  for (const account of state.accounts || []) {
    head.push(`- ${clip(account.name, 30)}: 役割 ${account.role || "不明"}、使える額に${account.includeInSpendable === false ? "含めない" : "含める"}、口座ごとの予備額 ${yen(account.reserveAmount)}`);
  }
  if ((state.cards || []).length) {
    head.push("カード:");
    for (const card of state.cards) {
      head.push(`- ${clip(card.name, 20)}: ${card.closingDay ? `${card.closingDay}日締め` : "月末締め"}・${card.paymentDay ? `${card.paymentDay}日払い` : "月末払い"}（締め月の${["同じ月", "翌月", "翌々月"][Number(card.paymentMonthOffset ?? 1)] || "翌月"}）、引落口座 ${accountName(card.accountId)}${Number.isInteger(card.reflectionDays) ? `、請求額への反映まで${card.reflectionDays}日` : ""}`);
    }
  }
  const settings = state.settings || {};
  const wage = settings.wage || {};
  head.push(`設定: 最低限残す予備額 ${yen(settings.defenseLine)}、見通しの日数 ${settings.cashflowHorizonDays || 90}日、時給 ${yen(wage.hourlyRate)}、給料日 ${wage.paymentDay || "未設定"}日`);

  const future = (state.transactions || [])
    .filter((t) => t && t.status === "planned" && (t.dueDate || "") >= today && t.entryType !== "itemized")
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  if (future.length) {
    head.push(`登録してある予定（今日以降、全${future.length}件）:`);
    for (const t of future) head.push(`- ${t.dueDate} ${KIND_LABELS[t.kind] || t.kind} ${yen(t.amount)} ${clip(t.memo || t.category, 20)}（${clip(t.category, 10)}${t.cardId ? `、${cardName(t.cardId)}` : ""}${t.sourceAccountId ? `、${accountName(t.sourceAccountId)}` : ""}${t.lendingAmount ? `、うち立替 ${yen(t.lendingAmount)}` : ""}${t.salaryPaymentMonth ? "、給料" : ""}）`);
  }

  const groups = cardGroups.filter((group) => (group.dueDate || "") >= today);
  if (groups.length) {
    head.push("カードの請求（引落日ごと）:");
    for (const group of groups) {
      const statement = group.statements?.[0];
      head.push(`- ${group.dueDate} ${cardName(group.cardId)}（${group.billingCycle}締め）: ${statement
        ? `登録した請求額 ${yen(group.statementTotal)}（${group.statementAsOf || "?"}に見た額）、内訳の明細 ${group.itemized.length}件 ${yen(group.itemizedTotal)}、うち請求額にまだ入っていない ${yen(group.pendingTotal)}`
        : `請求額は未登録。メールの明細 ${group.itemized.length}件 ${yen(group.itemizedTotal)}`}`);
    }
  }

  if (months.length) {
    head.push("月ごとの確定した収支（全期間、新しい順）:");
    for (const { month, summary } of months.slice().sort((a, b) => b.month.localeCompare(a.month))) {
      const top = (summary.expense?.categories || []).slice(0, 5).map((item) => `${clip(item.label, 10)} ${yen(item.amount)}`).join("、");
      head.push(`- ${month}: 収入 ${yen(summary.income?.total)}、支出 ${yen(summary.expense?.total)}、貯蓄・投資 ${yen(summary.saving?.total)}、立替 ${yen(summary.lendingTotal)}${top ? `（支出の内訳: ${top}）` : ""}`);
    }
  }

  const plans = (state.recurringPlans || []).filter(Boolean);
  if (plans.length) {
    head.push("定期支払い（全部）:");
    for (const plan of plans) head.push(`- ${clip(plan.name || plan.memo || "定期", 20)} ${yen(plan.amount)}（${plan.interval || "毎月"}、${plan.dayOfMonth ? `${plan.dayOfMonth}日` : ""}${plan.cardId ? `、${cardName(plan.cardId)}` : ""}${plan.active === false || plan.isActive === false ? "、停止中" : ""}）`);
  }

  const work = (state.workEntries || []).filter((entry) => entry && entry.date).sort((a, b) => b.date.localeCompare(a.date));
  if (work.length) {
    head.push(`シフト（全${work.length}件、新しい順）:`);
    for (const entry of work) head.push(`- ${entry.date} ${entry.hours}時間（${entry.status === "worked" ? "勤務済み" : "予定"}${entry.hourlyRateOverride ? `、時給 ${yen(entry.hourlyRateOverride)}` : ""}${entry.memo ? `、${clip(entry.memo, 12)}` : ""}）`);
  }

  if (receiptItems.length) {
    const wasted = receiptItems.filter((item) => item.wasteAmount > 0);
    head.push(`レシートの品物 ${receiptItems.length}件（レシート ${receipts.length}枚）。捨てた・ムダになった額の合計 ${yen(wasted.reduce((sum, item) => sum + Number(item.wasteAmount || 0), 0))}`);
    const byReceipt = new Map(receipts.map((receipt) => [receipt.id, receipt]));
    const sorted = receiptItems.slice().sort((a, b) => String(byReceipt.get(b.receiptId)?.purchasedAt || "").localeCompare(String(byReceipt.get(a.receiptId)?.purchasedAt || "")));
    for (const item of sorted) {
      const receipt = byReceipt.get(item.receiptId);
      head.push(`- ${day(receipt?.purchasedAt) || "日付不明"} ${clip(receipt?.storeName, 12)} ${clip(item.name || item.rawName, 20)} ${yen(item.amount)}（${clip(item.category, 8)}${item.outcomeTracked ? `、${OUTCOME_LABELS[item.outcome] || item.outcome}` : ""}${item.wasteAmount ? `、ムダ ${yen(item.wasteAmount)}${item.outcomeReason ? `・${clip(item.outcomeReason, 10)}` : ""}` : ""}）`);
    }
  }
  if (pendingMails) head.push(`メール取込の確認待ち: ${pendingMails}件（まだ記録に入っていない）`);

  // 取引の記録は全件。上限を超えるときだけ古いほうから省く
  const history = (state.transactions || [])
    .filter((t) => t && t.status !== "planned")
    .sort((a, b) => String(b.transactionDate || b.dueDate).localeCompare(String(a.transactionDate || a.dueDate)));
  const lines = [...head, `取引の記録（全${history.length}件、新しい順。「請求額の内訳」はカードの請求額に含まれる明細なので、支出として二重に数えない）:`];
  let length = lines.join("\n").length;
  let shown = 0;
  for (const t of history) {
    const line = `- ${t.transactionDate || t.dueDate} ${KIND_LABELS[t.kind] || t.kind}・${STATUS_LABELS[t.status] || t.status} ${yen(t.amount)} ${clip(t.memo || t.category, 20)}（${clip(t.category, 10)}${t.cardId ? `、${cardName(t.cardId)}` : ""}${t.lendingAmount ? `、うち立替 ${yen(t.lendingAmount)}` : ""}）`;
    if (length + line.length + 1 > budget) break;
    lines.push(line);
    length += line.length + 1;
    shown += 1;
  }
  if (shown < history.length) lines.push(`（文字数の上限のため、これより古い取引 ${history.length - shown}件は省きました。月ごとの収支には全期間が入っています）`);
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
