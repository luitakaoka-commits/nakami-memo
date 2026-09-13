/**
 * レシピ提案（Phase 3）の、ネットワークも Firebase も使わない部分。
 *
 * API（src/app/api/recipes/suggest/route.ts）と画面の両方から使い、Node から直接テストする
 * （src/lib/recipes/suggest-core.test.mjs。node --experimental-strip-types で .ts のまま読む）。
 * そのため、このファイルは型以外を import しない。
 *
 * この機能の存在理由は「期限が近い食材を使い切らせる」こと（設計書 7章）。
 * 便利なレシピ検索ではなく、廃棄を減らす実行部隊なので、次の4つを必ず守らせる。
 *   1. 期限が近い食材（または本人が選んだ食材）を必ず使う
 *   2. 持っていない調理器具を使わせない
 *   3. 調味料は在庫を優先し、無いものは材料ではなく「買い足し」に分ける
 *   4. 在庫の量を超えて使わせない
 * AI の返答は信用しきらず、sanitizeSuggestions で在庫・器具と突き合わせてから画面に出す。
 */

/** 在庫のうち、レシピに使ってよいカテゴリ。洗剤や電池を材料にさせない。 */
export const FOOD_CATEGORIES = ["食品", "飲料", "調味料"] as const;

/** つくりおきノートのカテゴリ（public/recipe/app.js の CATEGORIES と同じ並び）。 */
export const RECIPE_CATEGORIES = ["主菜", "副菜", "汁物", "ごはん", "麺", "お菓子", "その他"] as const;

/** 調理器具の種類（設計書 3-2）。 */
export const TOOL_TYPES = ["鍋", "フライパン", "オーブン", "電子レンジ", "炊飯器", "圧力鍋", "ホットプレート", "トースター", "その他"] as const;

/** 調理器具の特徴。レシピの可否に効くものだけ。 */
export const TOOL_FEATURES = ["オーブン可", "IH対応", "食洗機可", "タイマー", "無水調理"] as const;

/** 器具を1つも登録していないときに前提にする器具。何も使えないとレシピが作れないため。 */
export const BASIC_TOOLS_WHEN_EMPTY = ["コンロ", "鍋", "フライパン", "電子レンジ"] as const;

/** 「期限が近い」とみなす日数。この範囲の食材は、何も選ばなくても必ず使う食材に入る。 */
export const MUST_USE_WITHIN_DAYS = 3;

/** 1回に提案させる数。多いと待ち時間が延び、選ぶのも大変になる。 */
export const MAX_SUGGESTIONS = 3;

export type PantryItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  category: string;
  /** 期限まであと何日か。期限が無ければ null。過ぎていればマイナス。 */
  expiresInDays: number | null;
};

export type KitchenTool = {
  id: string;
  name: string;
  type: string;
  sizeLabel: string;
  features: string[];
};

export type SuggestOptions = {
  servings: number;
  maxMinutes: number;
  mustUseItemIds: string[];
  excludeIngredients: string[];
};

export type SuggestedIngredient = {
  name: string;
  amount: string;
  unit: string;
  /** 在庫から使うときの在庫ID。買ってくるものは null。 */
  itemId: string | null;
  inStock: boolean;
};

export type RecipeSuggestion = {
  title: string;
  category: (typeof RECIPE_CATEGORIES)[number];
  servings: number;
  estMinutes: number;
  ingredients: SuggestedIngredient[];
  /** 在庫に無く、作るなら買い足しが要るもの。 */
  shoppingNeeded: string[];
  steps: string[];
  toolIds: string[];
  /** このレシピで使う在庫のID。 */
  usesItemIds: string[];
  /** 在庫の量を超えている、など、画面で注意を出したいこと。 */
  warnings: string[];
};

export type SuggestResult = {
  recipes: RecipeSuggestion[];
  /** 必ず使うはずだったのに、どのレシピにも入らなかった食材の名前。 */
  uncoveredMustUse: string[];
};

/* ---------- 在庫と器具を、提案に使う形へ ---------- */

type RawItem = {
  id: string;
  name?: unknown;
  quantity?: unknown;
  unit?: unknown;
  category?: unknown;
  /** ミリ秒。Firestore の Timestamp は呼び出し側で数値にして渡す。 */
  expirationMillis?: number | null;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** 期限まで何日か。日付の境目はローカル時刻の0時。 */
export function daysBetween(fromMillis: number, toMillis: number): number {
  const from = new Date(fromMillis);
  const to = new Date(toMillis);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((end - start) / 86400000);
}

/**
 * 在庫から、レシピに使える食材だけを取り出す。
 * 数量0（使い切った）と、食べ物以外のカテゴリ、カテゴリ未設定は除く。
 * 並びは期限が近い順（期限なしは最後）。
 */
export function pickPantry(items: RawItem[], nowMillis: number): PantryItem[] {
  return items
    .map((item) => ({
      id: item.id,
      name: text(item.name),
      quantity: num(item.quantity),
      unit: text(item.unit),
      category: text(item.category),
      expiresInDays: typeof item.expirationMillis === "number" ? daysBetween(nowMillis, item.expirationMillis) : null,
    }))
    .filter((item) => item.id && item.name && item.quantity > 0 && (FOOD_CATEGORIES as readonly string[]).includes(item.category))
    .sort((a, b) => {
      const da = a.expiresInDays ?? Number.POSITIVE_INFINITY;
      const db = b.expiresInDays ?? Number.POSITIVE_INFINITY;
      return da - db || a.name.localeCompare(b.name, "ja");
    });
}

/** 何も選ばなくても必ず使う食材（期限切れは除く。食べさせない）。 */
export function defaultMustUseIds(pantry: PantryItem[], withinDays = MUST_USE_WITHIN_DAYS): string[] {
  return pantry
    .filter((item) => item.expiresInDays !== null && item.expiresInDays >= 0 && item.expiresInDays <= withinDays && item.category !== "調味料")
    .map((item) => item.id);
}

export function normalizeTools(tools: Array<{ id: string; name?: unknown; type?: unknown; sizeLabel?: unknown; features?: unknown }>): KitchenTool[] {
  return tools
    .map((tool) => ({
      id: tool.id,
      name: text(tool.name),
      type: (TOOL_TYPES as readonly string[]).includes(text(tool.type)) ? text(tool.type) : "その他",
      sizeLabel: text(tool.sizeLabel),
      features: Array.isArray(tool.features) ? tool.features.filter((f): f is string => typeof f === "string") : [],
    }))
    .filter((tool) => tool.id && tool.name);
}

/** 画面から来た条件を、安全な範囲にそろえる。 */
export function normalizeOptions(raw: Partial<Record<keyof SuggestOptions, unknown>>, pantry: PantryItem[]): SuggestOptions {
  const ids = new Set(pantry.map((item) => item.id));
  const servings = Math.round(num(raw.servings));
  const maxMinutes = Math.round(num(raw.maxMinutes));
  const mustUse = Array.isArray(raw.mustUseItemIds) ? raw.mustUseItemIds.filter((id): id is string => typeof id === "string" && ids.has(id)) : [];
  const exclude = Array.isArray(raw.excludeIngredients)
    ? raw.excludeIngredients.map(text).filter(Boolean).slice(0, 20)
    : [];
  return {
    servings: servings >= 1 && servings <= 8 ? servings : 2,
    maxMinutes: maxMinutes >= 5 && maxMinutes <= 180 ? maxMinutes : 30,
    mustUseItemIds: [...new Set(mustUse)],
    excludeIngredients: exclude.map((name) => name.slice(0, 30)),
  };
}

/* ---------- AI への指示 ---------- */

function describeExpiry(days: number | null) {
  if (days === null) return "期限なし";
  if (days < 0) return `期限切れ${-days}日`;
  if (days === 0) return "今日まで";
  return `あと${days}日`;
}

export function buildPrompt(pantry: PantryItem[], tools: KitchenTool[], options: SuggestOptions): string {
  const mustUse = pantry.filter((item) => options.mustUseItemIds.includes(item.id));
  const stockLines = pantry
    .filter((item) => item.expiresInDays === null || item.expiresInDays >= 0)
    .map((item) => `- id=${item.id} ／ ${item.name} ／ ${item.quantity}${item.unit} ／ ${item.category} ／ ${describeExpiry(item.expiresInDays)}`);
  const toolLines = tools.length
    ? tools.map((tool) => `- id=${tool.id} ／ ${tool.type}「${tool.name}」${tool.sizeLabel ? ` ／ ${tool.sizeLabel}` : ""}${tool.features.length ? ` ／ ${tool.features.join("・")}` : ""}`)
    : [`（登録なし。${BASIC_TOOLS_WHEN_EMPTY.join("・")}だけがあるものとして考える。toolIds は空にする）`];

  return [
    "あなたは日本の家庭料理に詳しい料理アシスタントです。",
    "家にある食材を無駄にしないためのレシピを考えてください。",
    "",
    "【家にある食材】（id は後で照合に使うので、そのまま書き写すこと）",
    ...(stockLines.length ? stockLines : ["（なし）"]),
    "",
    "【必ず使う食材】",
    ...(mustUse.length ? mustUse.map((item) => `- id=${item.id} ／ ${item.name}（${describeExpiry(item.expiresInDays)}）`) : ["（指定なし。期限が近いものを優先して使う）"]),
    "",
    "【使える調理器具】",
    ...toolLines,
    "",
    "【条件】",
    `- ${options.servings}人分`,
    `- 調理時間は${options.maxMinutes}分以内`,
    ...(options.excludeIngredients.length ? [`- 次の食材は使わない: ${options.excludeIngredients.join("、")}`] : []),
    "",
    "【必ず守ること】",
    `- レシピは${MAX_SUGGESTIONS}つ。似た料理を並べない。`,
    "- 必ず使う食材は、どれかのレシピで必ず使う。各レシピは必ず使う食材を1つ以上含める（指定がある場合）。",
    "- 使える調理器具に無い器具（オーブンなど）が要る料理は出さない。使う器具の id を toolIds に入れる。",
    "- 在庫の量を超えて使わない。卵が2個しかなければ3個以上使わない。",
    "- 在庫から使う材料は、itemId にその食材の id を書き、inStock を true にする。",
    "- 在庫に無い材料は itemId を空文字、inStock を false にし、shoppingNeeded にも名前を入れる。",
    "- 調味料は在庫にあるものを優先する。水・塩・こしょう・砂糖・醤油・サラダ油は在庫に無くても家にあるものとして inStock を true、itemId は空文字にしてよい。",
    "- usesItemIds には、そのレシピで使う在庫の id を全部入れる。",
    "- 手順は短い文で3〜8個。",
    `- category は ${RECIPE_CATEGORIES.join("・")} のどれか。`,
  ].join("\n");
}

/** Gemini に返させる JSON の形（responseSchema）。 */
export function responseSchema() {
  return {
    type: "OBJECT",
    properties: {
      recipes: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING" },
            category: { type: "STRING", enum: [...RECIPE_CATEGORIES] },
            servings: { type: "NUMBER" },
            estMinutes: { type: "NUMBER" },
            ingredients: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING" },
                  amount: { type: "STRING", description: "量の数字や「少々」。単位は unit に分ける" },
                  unit: { type: "STRING" },
                  itemId: { type: "STRING", description: "在庫から使うならその id。無ければ空文字" },
                  inStock: { type: "BOOLEAN" },
                },
                required: ["name", "amount", "unit", "itemId", "inStock"],
              },
            },
            shoppingNeeded: { type: "ARRAY", items: { type: "STRING" } },
            steps: { type: "ARRAY", items: { type: "STRING" } },
            toolIds: { type: "ARRAY", items: { type: "STRING" } },
            usesItemIds: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["title", "category", "servings", "estMinutes", "ingredients", "shoppingNeeded", "steps", "toolIds", "usesItemIds"],
        },
      },
    },
    required: ["recipes"],
  };
}

/* ---------- AI の返答を在庫・器具と突き合わせる ---------- */

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => text(entry)).filter(Boolean) : [];

/** 「2」「1/2」「0.5」のような量を数にする。「少々」などは null。 */
export function parseAmount(amount: string): number | null {
  const value = amount.trim().replace(/[０-９．／]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  const fraction = value.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) return Number(fraction[2]) ? Number(fraction[1]) / Number(fraction[2]) : null;
  return /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
}

export function sanitizeSuggestions(raw: unknown, pantry: PantryItem[], tools: KitchenTool[], options: SuggestOptions): SuggestResult {
  const byId = new Map(pantry.map((item) => [item.id, item]));
  const byName = new Map(pantry.map((item) => [item.name, item]));
  const toolIds = new Set(tools.map((tool) => tool.id));
  const excluded = options.excludeIngredients;
  const list = raw && typeof raw === "object" && Array.isArray((raw as { recipes?: unknown }).recipes)
    ? (raw as { recipes: unknown[] }).recipes
    : [];

  const recipes: RecipeSuggestion[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const title = text(r.title);
    const steps = strings(r.steps).slice(0, 12);
    if (!title || !steps.length) continue;

    const warnings: string[] = [];
    const shopping = new Set(strings(r.shoppingNeeded));
    const ingredients: SuggestedIngredient[] = (Array.isArray(r.ingredients) ? r.ingredients : [])
      .filter((ing): ing is Record<string, unknown> => Boolean(ing) && typeof ing === "object")
      .map((ing) => {
        const name = text(ing.name);
        // id を書き間違えても、名前が在庫と完全に一致すればその在庫とみなす
        const stock = byId.get(text(ing.itemId)) ?? byName.get(name) ?? null;
        const inStock = stock ? true : ing.inStock === true;
        return { name, amount: text(ing.amount), unit: text(ing.unit), itemId: stock ? stock.id : null, inStock };
      })
      .filter((ing) => ing.name);

    for (const ing of ingredients) {
      if (!ing.itemId) continue;
      const stock = byId.get(ing.itemId)!;
      const amount = parseAmount(ing.amount);
      if (amount !== null && stock.unit && ing.unit === stock.unit && amount > stock.quantity) {
        warnings.push(`${stock.name}を${amount}${stock.unit}使いますが、在庫は${stock.quantity}${stock.unit}です`);
      }
      if (stock.expiresInDays !== null && stock.expiresInDays < 0) {
        warnings.push(`${stock.name}は期限が切れています。状態を確かめてから使ってください`);
      }
    }
    for (const name of excluded) {
      if (ingredients.some((ing) => ing.name.includes(name))) warnings.push(`使わない指定の「${name}」が入っています`);
    }
    // 在庫に無いと分かった材料は、AI が書き忘れていても買い足しに入れる
    ingredients.filter((ing) => !ing.inStock).forEach((ing) => shopping.add(ing.name));

    const uses = new Set([
      ...strings(r.usesItemIds).filter((id) => byId.has(id)),
      ...ingredients.map((ing) => ing.itemId).filter((id): id is string => Boolean(id)),
    ]);
    const category = (RECIPE_CATEGORIES as readonly string[]).includes(text(r.category)) ? text(r.category) : "その他";
    const servings = Math.round(num(r.servings));
    const minutes = Math.round(num(r.estMinutes));

    recipes.push({
      title: title.slice(0, 60),
      category: category as RecipeSuggestion["category"],
      servings: servings >= 1 && servings <= 12 ? servings : options.servings,
      estMinutes: minutes >= 1 && minutes <= 480 ? minutes : options.maxMinutes,
      ingredients,
      shoppingNeeded: [...shopping],
      steps,
      toolIds: strings(r.toolIds).filter((id) => toolIds.has(id)),
      usesItemIds: [...uses],
      warnings,
    });
    if (recipes.length >= MAX_SUGGESTIONS) break;
  }

  const covered = new Set(recipes.flatMap((recipe) => recipe.usesItemIds));
  const uncoveredMustUse = options.mustUseItemIds
    .filter((id) => !covered.has(id))
    .map((id) => byId.get(id)?.name ?? "")
    .filter(Boolean);

  return { recipes, uncoveredMustUse };
}

/* ---------- Firestore REST の返答を読む ---------- */

type FirestoreValue = Record<string, unknown>;

/** Firestore REST API の値表現を、ふつうの値に戻す。Timestamp はミリ秒にする。 */
export function fromFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) {
    const millis = Date.parse(String(value.timestampValue));
    return Number.isFinite(millis) ? millis : null;
  }
  if ("arrayValue" in value) {
    const values = (value.arrayValue as { values?: FirestoreValue[] } | undefined)?.values ?? [];
    return values.map(fromFirestoreValue);
  }
  if ("mapValue" in value) {
    const fields = (value.mapValue as { fields?: Record<string, FirestoreValue> } | undefined)?.fields ?? {};
    return Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, fromFirestoreValue(entry)]));
  }
  return null;
}

/** REST の documents 一覧から { id, ...fields } の配列を作る。 */
export function documentsToObjects(documents: Array<{ name?: string; fields?: Record<string, FirestoreValue> }>): Array<Record<string, unknown> & { id: string }> {
  return documents
    .filter((docEntry) => typeof docEntry.name === "string")
    .map((docEntry) => {
      const id = docEntry.name!.split("/").pop() ?? "";
      const fields = Object.fromEntries(Object.entries(docEntry.fields ?? {}).map(([key, value]) => [key, fromFirestoreValue(value)]));
      return { ...fields, id };
    });
}

/* ---------- 回数の制限 ---------- */

/**
 * 1人あたりの呼び出し回数を、直近の時間枠で数える。
 * 無料枠を1回の連打で使い切らないため（設計書: 1ユーザー 1分5回）。
 * サーバーのメモリに持つので、Vercel の別インスタンス同士では共有されない。あくまで連打よけ。
 */
export function createThrottle(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return function allow(key: string, nowMs: number): boolean {
    const recent = (hits.get(key) ?? []).filter((time) => nowMs - time < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    hits.set(key, recent);
    return true;
  };
}

/* ---------- つくりおきノートへの保存と、「作った」 ---------- */

/** つくりおきノートの材料は「鶏もも肉 300g」の1行文字列。 */
export function ingredientLine(ing: SuggestedIngredient): string {
  const amount = `${ing.amount}${ing.unit}`.trim();
  return amount ? `${ing.name} ${amount}` : ing.name;
}

/**
 * つくりおきノート（users/{uid}/recipes）に保存する形。public/recipe/app.js の normalizeRecipe と同じ項目。
 * source の「AIの提案」は、つくりおきノート側の SOURCES にも足してある。
 */
export function toTsukuriokiRecipe(recipe: RecipeSuggestion, toolNames: string[], nowMillis: number) {
  const memo = [
    "なかみメモの在庫から提案されたレシピです。",
    `目安 ${recipe.estMinutes}分`,
    ...(toolNames.length ? [`使う器具: ${toolNames.join("、")}`] : []),
    ...(recipe.shoppingNeeded.length ? [`買い足し: ${recipe.shoppingNeeded.join("、")}`] : []),
  ].join("\n");
  return {
    title: recipe.title,
    memo,
    category: recipe.category,
    servings: recipe.servings,
    ingredients: recipe.ingredients.map(ingredientLine),
    steps: recipe.steps,
    source: "AIの提案",
    refUrl: "",
    image: "",
    createdAt: nowMillis,
    lastCookedAt: 0,
  };
}

/** 数え方が「1つ2つ」になる単位。量が書いてなくても1つ減らすのが自然なもの。 */
const COUNT_UNITS = ["個", "本", "枚", "袋", "パック", "玉", "束", "丁", "切れ", "尾", "缶"];

/**
 * 「作った」ときに、それぞれの在庫をどれだけ減らすかの初期値。画面で本人が直せる。
 * - 単位が同じで量が数字 → その量
 * - 調味料 → 減らさない（大さじ1で1本減ると困る）
 * - 数え方の単位 → 1
 * - それ以外（g で書かれた肉が「パック」で在庫にある等）→ 1
 * どれも在庫の数量を超えない。
 */
export function defaultConsumption(recipe: RecipeSuggestion, pantry: Array<Pick<PantryItem, "id" | "name" | "quantity" | "unit" | "category">>) {
  const byId = new Map(pantry.map((item) => [item.id, item]));
  const totals = new Map<string, number>();
  for (const ing of recipe.ingredients) {
    if (!ing.itemId || !byId.has(ing.itemId)) continue;
    const item = byId.get(ing.itemId)!;
    const amount = parseAmount(ing.amount);
    let use: number;
    if (amount !== null && item.unit && ing.unit === item.unit) use = amount;
    else if (item.category === "調味料") use = 0;
    else if (COUNT_UNITS.includes(item.unit) && amount !== null && (ing.unit === "" || COUNT_UNITS.includes(ing.unit))) use = amount;
    else use = 1;
    totals.set(item.id, (totals.get(item.id) ?? 0) + use);
  }
  for (const id of recipe.usesItemIds) {
    if (!totals.has(id) && byId.has(id)) totals.set(id, byId.get(id)!.category === "調味料" ? 0 : 1);
  }
  return [...totals.entries()].map(([id, use]) => {
    const item = byId.get(id)!;
    return { itemId: id, name: item.name, unit: item.unit, available: item.quantity, use: Math.max(0, Math.min(use, item.quantity)) };
  });
}

/** 減らしたあとの数量。マイナスにしない。小数の誤差を丸める。 */
export function remainingQuantity(current: number, use: number): number {
  return Math.max(0, Math.round((current - Math.max(0, use)) * 1000) / 1000);
}
