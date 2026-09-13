/* 引っ越し（なかみメモ・つくりおきノート → cash-manege）の、ネットワークを使わない部分。
 * Node からテストできるように、Firebase には一切触らない（public/shared/migrate.test.mjs）。
 */

/** 書き写す元。どちらも users/{uid}/{コレクション} の形で持っている。 */
export const SOURCES = [
  { key: "nakami", label: "なかみメモ", collections: [
    { name: "areas", label: "エリア" },
    { name: "locations", label: "保管場所" },
    { name: "items", label: "モノ" },
  ] },
  { key: "recipe", label: "つくりおきノート", collections: [
    { name: "recipes", label: "レシピ" },
    { name: "plans", label: "献立" },
    { name: "shopping", label: "買い物リスト" },
  ] },
];

/** 1回の書き込みバッチに入れる件数。Firestore の上限は500なので余裕を持たせる。 */
export const BATCH_SIZE = 400;

export function chunk(list, size = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** 公開中の保管場所の、公開用ドキュメントのID（publicToken）を集める。 */
export function publicTokensOf(locations) {
  return [...new Set(locations
    .filter((location) => location && location.isPublic === true && typeof location.publicToken === "string" && location.publicToken)
    .map((location) => location.publicToken))];
}

/**
 * 公開用ドキュメントの持ち主を、引っ越し先の uid に書き換える。
 * ルールが「持ち主本人しか作れない・直せない」なので、ここを変えないと書き込みが断られ、
 * 引っ越し後に公開ページを更新できなくなる。
 */
export function remapPublicLocation(data, newUid) {
  return { ...data, ownerId: newUid };
}

/**
 * 3つのログインが同じ人かを確かめる。違う Google アカウントのデータを混ぜないため。
 * まだログインしていない元（null）は比べない。
 */
export function sameAccount(emails) {
  const known = emails.filter((email) => typeof email === "string" && email).map((email) => email.toLowerCase());
  return known.length <= 1 || known.every((email) => email === known[0]);
}

/**
 * 引っ越し元と引っ越し先の件数を並べる。
 * 先に余分があっても（前に1度書き写した後で元を消した、など）失敗にはしない。元にあるIDが全部あるかで判定する。
 */
export function compareCollections(sourceIds, destIds) {
  const dest = new Set(destIds);
  const missing = sourceIds.filter((id) => !dest.has(id));
  return { source: sourceIds.length, dest: destIds.length, missing, ok: missing.length === 0 };
}
