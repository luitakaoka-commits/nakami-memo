/**
 * 在庫AI（2026-11-14 ユーザー要望）の、ネットワークを使わない部分。
 *
 * - 「まだ残っている」「使い切った」「捨てた」「料理で使い切った」を、在庫が消えても残る記録（stockEvents）にする。
 *   在庫そのものは0になると消える（2026-09-21 決定）ので、ここに残さないと「何日で使い切るか」が分からない
 * - 何日で使い切るか（買った日＝在庫に入れた日 → 使い切った日）から、次の買い時を出す。日付は AI に作らせず、ここで計算する
 * - 同じ商品かどうかは **AI が候補を出し、本人が「同じ／別」を決める**（ユーザー決定。意味の判断を自動でやらない、を守る）。
 *   決めた結果は productLinks に残り、次から同じ商品として数える
 *
 * サーバー（src/app/api/inventory/insights/route.ts）と画面の両方から使い、Node から直接テストする（stock-core.test.mjs）。
 * そのため型以外を import しない。
 */

export const STOCK_EVENTS = "stockEvents";
export const PRODUCT_LINKS = "productLinks";
/** 在庫AIの結果。からだの記録を使うので家には置かず、本人の場所（users/{uid}）だけに置く */
export const INVENTORY_INSIGHTS = "inventoryInsights";
/** 「まだ残っている」を押したら、買い替え時の一覧から外しておく日数（ユーザー決定「記録して数日隠す」） */
export const REMAINING_SNOOZE_DAYS = 3;
/** 次の買い時を出す範囲（この日数以内に切れそうなもの） */
export const NEXT_BUY_HORIZON_DAYS = 7;
/** AI に考え直させる間隔（ホームを開いたとき、前回からこれ以上たっていれば。ユーザー決定） */
export const INSIGHT_REFRESH_MS = 24 * 60 * 60 * 1000;

export type StockEventKind = "consumed" | "discarded" | "remaining";

export type StockEvent = {
  itemId: string;
  name: string;
  /** 機械的に正規化した品名（productKey）。同じ商品のまとめは読むときに productLinks で行う */
  key: string;
  kind: StockEventKind;
  /** 在庫に入れた日（YYYY-MM-DD、日本時間）。分からなければ null */
  since: string | null;
  /** 記録した日（YYYY-MM-DD、日本時間） */
  at: string;
  quantity: number;
  unit: string;
  category: string;
};

export type ProductLink = { a: string; b: string; same: boolean };

const DAY = 86_400_000;

/** 日本時間の日付（YYYY-MM-DD） */
export function japanDay(millis: number): string {
  return new Date(millis + 9 * 3_600_000).toISOString().slice(0, 10);
}

const dayMillis = (day: string) => Date.parse(`${day}T00:00:00Z`);

export function daysBetween(from: string, to: string): number {
  return Math.round((dayMillis(to) - dayMillis(from)) / DAY);
}

export function addDays(day: string, days: number): string {
  return new Date(dayMillis(day) + days * DAY).toISOString().slice(0, 10);
}

const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * 品名の機械的な正規化（名寄せの1段目）。全角半角・大文字小文字・ひらがなとカタカナ・空白と記号・
 * レシートの先頭の部門コード（「* 3271 」）をそろえる。意味の判断はしない（牛乳と低脂肪乳は別のまま）。
 * Firestore のドキュメントIDにも使うので、文字と数字だけを残す。
 */
export function productKey(name: string): string {
  return String(name ?? "")
    .normalize("NFKC")
    .replace(/^\s*\*?\s*\d{3,6}\s+/, "")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** 2つの品名の組のID（順番によらず同じ） */
export function linkId(a: string, b: string): string {
  return [a, b].sort().join("__");
}

/** 本人が「同じ」と決めた組をつないで、代表のキーを返す関数を作る（「別」と決めた組はつながない） */
export function canonicalizer(links: ProductLink[]): (key: string) => string {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const link of links) {
    if (!link.same || !link.a || !link.b) continue;
    const ra = find(link.a);
    const rb = find(link.b);
    if (ra === rb) continue;
    // 代表は辞書順で小さいほう（どの順で決めても同じ結果になるように）
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  }
  return (key) => find(key);
}

type ItemLike = { id: string; name: string; quantity?: number; unit?: string; category?: string; since?: string | null };

/** 記録1件を作る */
export function stockEventFor(item: ItemLike, kind: StockEventKind, today: string): StockEvent {
  return {
    itemId: item.id,
    name: String(item.name ?? ""),
    key: productKey(item.name),
    kind,
    since: isDay(item.since) ? item.since : null,
    at: today,
    quantity: Number(item.quantity) || 0,
    unit: String(item.unit ?? ""),
    category: String(item.category ?? ""),
  };
}

/** 「まだ残っている」を押してから、まだ数日たっていないか（そのあいだは買い替え時の一覧に出さない） */
export function isRemainingSnoozed(item: { remainingCheckedAt?: string | null }, today: string): boolean {
  return isDay(item.remainingCheckedAt) && daysBetween(item.remainingCheckedAt, today) < REMAINING_SNOOZE_DAYS;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export type UsageStats = {
  key: string;
  name: string;
  /** 入れた日から使い切った（捨てた）日までの日数 */
  cycles: number[];
  typicalDays: number | null;
  lastEnd: string | null;
  lastEndKind: StockEventKind | null;
};

/** 記録のキー。つくりおきノートから書いた記録は key を持たないので、品名から作り直す */
export function keyOfEvent(event: Pick<StockEvent, "key" | "name">): string {
  return event.key || productKey(event.name);
}

/** 商品ごとの「何日で使い切るか」 */
export function usageStats(events: StockEvent[], canonical: (key: string) => string): Map<string, UsageStats> {
  const stats = new Map<string, UsageStats>();
  const sorted = [...events].filter((event) => isDay(event.at) && keyOfEvent(event)).sort((a, b) => a.at.localeCompare(b.at));
  for (const event of sorted) {
    const key = canonical(keyOfEvent(event));
    const entry = stats.get(key) ?? { key, name: event.name, cycles: [], typicalDays: null, lastEnd: null, lastEndKind: null };
    if (event.kind === "consumed" || event.kind === "discarded") {
      if (event.since) {
        const days = daysBetween(event.since, event.at);
        if (days >= 1 && days <= 730) entry.cycles.push(days);
      }
      entry.lastEnd = event.at;
      entry.lastEndKind = event.kind;
      entry.name = event.name || entry.name;
    }
    stats.set(key, entry);
  }
  for (const entry of stats.values()) entry.typicalDays = median(entry.cycles);
  return stats;
}

export type NextBuy = {
  key: string;
  name: string;
  /** 在庫にあるならその在庫のID。切れているなら null */
  itemId: string | null;
  inStock: boolean;
  /** 買うとよい日（YYYY-MM-DD） */
  dueDay: string;
  /** 今日から何日後か（0以下なら今日まで） */
  daysLeft: number;
  /** いつもは何日で使い切るか */
  typicalDays: number;
  /** その日数を何回分の記録から出したか */
  cycles: number;
};

type StockItem = { id: string; name: string; since?: string | null; remainingCheckedAt?: string | null };

/**
 * 次の買い時。
 * - 在庫にあるもの：入れた日＋いつもの日数。「まだ残っている」をその日より後に押していれば、押した日から数日後へずらす
 * - 切れているもの：2回以上使い切った記録があり、最後に使い切ってから60日以内なら「切れています」として出す
 * 同じ商品が2つ以上在庫にあるときは、いちばん遅く切れるほうで見る（片方が残っていれば切れていない）。
 */
export function nextBuys(items: StockItem[], events: StockEvent[], links: ProductLink[], today: string, horizon = NEXT_BUY_HORIZON_DAYS): NextBuy[] {
  const canonical = canonicalizer(links);
  const stats = usageStats(events, canonical);
  const lastRemaining = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== "remaining" || !isDay(event.at)) continue;
    const before = lastRemaining.get(event.itemId);
    if (!before || before < event.at) lastRemaining.set(event.itemId, event.at);
  }

  const latestByKey = new Map<string, NextBuy>();
  const inStockKeys = new Set<string>();
  for (const item of items) {
    const key = canonical(productKey(item.name));
    if (!key) continue;
    inStockKeys.add(key);
    const stat = stats.get(key);
    if (!stat?.typicalDays || !isDay(item.since)) continue;
    let due = addDays(item.since, stat.typicalDays);
    const checks = [lastRemaining.get(item.id), item.remainingCheckedAt].filter(isDay).sort();
    const checked = checks[checks.length - 1];
    if (checked && checked >= due) due = addDays(checked, REMAINING_SNOOZE_DAYS);
    const candidate: NextBuy = {
      key, name: item.name, itemId: item.id, inStock: true, dueDay: due, daysLeft: daysBetween(today, due),
      typicalDays: stat.typicalDays, cycles: stat.cycles.length,
    };
    const before = latestByKey.get(key);
    if (!before || before.dueDay < candidate.dueDay) latestByKey.set(key, candidate);
  }

  const result = [...latestByKey.values()].filter((entry) => entry.daysLeft <= horizon);
  for (const stat of stats.values()) {
    if (inStockKeys.has(stat.key) || !stat.typicalDays || stat.cycles.length < 2 || !stat.lastEnd) continue;
    if (stat.lastEndKind !== "consumed" || daysBetween(stat.lastEnd, today) > 60) continue;
    result.push({
      key: stat.key, name: stat.name, itemId: null, inStock: false, dueDay: stat.lastEnd, daysLeft: Math.min(0, daysBetween(today, stat.lastEnd)),
      typicalDays: stat.typicalDays, cycles: stat.cycles.length,
    });
  }
  return result.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, "ja"));
}

/** 次の買い時の文（画面に出す） */
export function nextBuyLabel(entry: NextBuy): string {
  if (!entry.inStock) return "切れています";
  if (entry.daysLeft < 0) return "そろそろ切れているころです";
  if (entry.daysLeft === 0) return "今日ごろ切れそうです";
  return `あと${entry.daysLeft}日ごろ切れそうです`;
}

/** AI に「同じ商品かどうか」を見せる品名（代表のキーごとに1つ。多すぎると無料枠と時間を食うので上限あり） */
export function namesForMatching(names: string[], links: ProductLink[], limit = 150): string[] {
  const canonical = canonicalizer(links);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const key = canonical(productKey(name));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(String(name).trim());
    if (result.length >= limit) break;
  }
  return result;
}

export type SamePair = { a: string; b: string; reason: string };
export type Nutrition = { summary: string; tips: string[] };
export type ShoppingIdea = { name: string; reason: string };
export type InventoryInsights = { samePairs: SamePair[]; nutrition: Nutrition | null; shopping: ShoppingIdea[] };

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * AI の返答を、手元の品名と本人の決定に突き合わせて安全な形にする。
 * - 同じ商品の候補：両方とも見せた品名にあり、まだ別のものとして数えていて、本人がまだ決めていない組だけ（5組まで）
 * - 栄養：一言と、3つまでのコツ
 * - 買い物の提案：5つまで。同じ名前は1つに
 */
export function sanitizeInsights(raw: unknown, names: string[], links: ProductLink[]): InventoryInsights {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const known = new Map(names.map((name) => [name.trim(), productKey(name)]));
  const canonical = canonicalizer(links);
  const decided = new Set(links.map((link) => linkId(canonical(link.a), canonical(link.b))));
  const decidedRaw = new Set(links.map((link) => linkId(link.a, link.b)));
  const samePairs: SamePair[] = [];
  const used = new Set<string>();
  for (const pair of Array.isArray(body.samePairs) ? body.samePairs : []) {
    const entry = pair && typeof pair === "object" ? (pair as Record<string, unknown>) : {};
    const a = text(entry.a, 80);
    const b = text(entry.b, 80);
    const ka = known.get(a);
    const kb = known.get(b);
    if (!ka || !kb) continue;
    const ca = canonical(ka);
    const cb = canonical(kb);
    const id = linkId(ca, cb);
    if (ca === cb || decided.has(id) || decidedRaw.has(linkId(ka, kb)) || used.has(id)) continue;
    used.add(id);
    samePairs.push({ a, b, reason: text(entry.reason, 80) });
    if (samePairs.length >= 5) break;
  }

  const rawNutrition = body.nutrition && typeof body.nutrition === "object" ? (body.nutrition as Record<string, unknown>) : null;
  const summary = text(rawNutrition?.summary, 160);
  const tips = (Array.isArray(rawNutrition?.tips) ? rawNutrition.tips : []).map((tip) => text(tip, 100)).filter(Boolean).slice(0, 3);
  const nutrition = summary ? { summary, tips } : null;

  const shopping: ShoppingIdea[] = [];
  const seen = new Set<string>();
  for (const idea of Array.isArray(body.shopping) ? body.shopping : []) {
    const entry = idea && typeof idea === "object" ? (idea as Record<string, unknown>) : {};
    const name = text(entry.name, 30);
    const key = productKey(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    shopping.push({ name, reason: text(entry.reason, 80) });
    if (shopping.length >= 5) break;
  }
  return { samePairs, nutrition, shopping };
}

/** 前回から1日以上たったか（ホームを開いたときに考え直すか） */
export function isInsightStale(generatedAtMillis: number | null | undefined, nowMillis: number): boolean {
  return !generatedAtMillis || !Number.isFinite(generatedAtMillis) || nowMillis - generatedAtMillis >= INSIGHT_REFRESH_MS;
}

export type FoodLine = { name: string; category: string; quantity: number; unit: string };

/** AI への指示 */
export function buildInsightsPrompt(input: { names: string[]; foods: FoodLine[]; nextBuys: NextBuy[]; healthLines: string[]; today: string }): string {
  const lines = [
    "あなたは家庭の在庫を見守る係です。日本語で、次の3つを JSON で返してください。",
    "",
    "1. samePairs: 下の【品名】のうち、表記が違うだけで明らかに同じ商品だと思う組（5組まで）。",
    "   - 同じとみなすのは、略し方・ブランド名の有無・全角半角・容量の書き方などが違うだけのもの。",
    "   - 種類が違うものは同じにしない（例: 牛乳と低脂肪乳、しょうゆと減塩しょうゆ、豚こまと豚バラ）。迷ったら出さない。",
    "   - a と b には【品名】に書かれているとおりの文字を入れる。reason は20字ほどで理由。",
    "2. nutrition: 【食べ物の在庫】だけを見た栄養のかたより。summary は1文（例: 野菜が少なく、肉と麺が多めです）。tips は3つまでの短い工夫。",
    "3. shopping: かたよりを直すため、または【次の買い時】のために買うとよいもの（5つまで）。name は一般的な食材名（例: ほうれん草）、reason は20字ほど。",
    "",
    "医療的な指示はしない。在庫に書かれていないものを在庫にあるように言わない。",
    "",
    `【今日】${input.today}`,
    "【品名】",
    ...(input.names.length ? input.names.map((name) => `- ${name}`) : ["（なし）"]),
    "",
    "【食べ物の在庫】",
    ...(input.foods.length ? input.foods.map((food) => `- ${food.name}（${food.category || "分類なし"}）${food.quantity}${food.unit}`) : ["（なし）"]),
    "",
    "【次の買い時】（これまでの記録から計算したもの）",
    ...(input.nextBuys.length ? input.nextBuys.map((entry) => `- ${entry.name}: ${nextBuyLabel(entry)}（いつもは約${entry.typicalDays}日で使い切る）`) : ["（なし）"]),
  ];
  if (input.healthLines.length) {
    lines.push("", "【からだの記録から】（医療的な指示ではない。参考にする程度でよい）", ...input.healthLines.map((line) => `- ${line}`));
  }
  return lines.join("\n");
}

/** Gemini の responseSchema */
export function insightsSchema() {
  return {
    type: "OBJECT",
    properties: {
      samePairs: {
        type: "ARRAY",
        items: { type: "OBJECT", properties: { a: { type: "STRING" }, b: { type: "STRING" }, reason: { type: "STRING" } }, required: ["a", "b", "reason"] },
      },
      nutrition: {
        type: "OBJECT",
        properties: { summary: { type: "STRING" }, tips: { type: "ARRAY", items: { type: "STRING" } } },
        required: ["summary", "tips"],
      },
      shopping: {
        type: "ARRAY",
        items: { type: "OBJECT", properties: { name: { type: "STRING" }, reason: { type: "STRING" } }, required: ["name", "reason"] },
      },
    },
    required: ["samePairs", "nutrition", "shopping"],
  };
}

/** 食べ物として栄養を見るカテゴリ（レシピ提案と同じ） */
export const FOOD_CATEGORIES = ["食品", "飲料", "調味料"];
