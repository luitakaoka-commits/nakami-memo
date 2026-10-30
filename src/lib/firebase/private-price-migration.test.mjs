/* 明示したローカルdemoエミュレーターの架空データだけを使う。 */
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { connectFirestoreEmulator, disableNetwork, doc, enableNetwork, getDoc, getFirestore } from "firebase/firestore";
import { inspectSharedPurchasePrices, migrateSelectedPurchasePrices, migrateSharedPurchasePrice } from "./private-price-migration.ts";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8487") throw new Error("ローカルエミュレーター専用です");
const host = process.env.FIRESTORE_EMULATOR_HOST;
const base = `http://${host}/v1/projects/demo-kurashi/databases/(default)/documents`;
const request = (path, fields) => fetch(`${base}/${path}`, { method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
const str = stringValue => ({ stringValue });
const num = n => ({ integerValue: String(n) });
const app = initializeApp({ projectId: "demo-kurashi", apiKey: "demo", appId: "demo" }, "private-price-test");
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8487, { mockUserToken: { sub: "owner-user", user_id: "owner-user" } });
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
async function seedItem(id, amount, workspaceId = "ws") {
  const fields = { name: str("架空の食品"), purchaseWorkspaceId: str(workspaceId), purchasePrice: num(amount) };
  assert.equal((await request(`households/home/items/${id}`, fields)).status, 200);
}
const shared = id => doc(db, "households", "home", "items", id);
const backup = id => doc(db, "users", "owner-user", "privatePurchasePrices", "home", "items", id);

test("購入金額を個人領域に保管して共有在庫から外す", async () => {
  await seedItem("one", 120);
  assert.equal(await migrateSharedPurchasePrice(db, "owner-user", "home", "one"), "migrated");
  const original = (await getDoc(shared("one"))).data(), saved = (await getDoc(backup("one"))).data();
  assert.equal(original.name, "架空の食品"); assert.equal(Object.hasOwn(original, "purchasePrice"), false);
  assert.equal(saved.amount, 120); assert.equal(saved.workspaceId, "ws");
  assert.equal(await migrateSharedPurchasePrice(db, "owner-user", "home", "one"), "no-price");
});
test("既存の保管金額が食い違うときは共有側を消さない", async () => {
  await seedItem("conflict", 120);
  assert.equal((await request("users/owner-user/privatePurchasePrices/home/items/conflict", { amount: num(121), householdId: str("home"), itemId: str("conflict"), workspaceId: str("ws") })).status, 200);
  await assert.rejects(migrateSharedPurchasePrice(db, "owner-user", "home", "conflict"), /一致しません/);
  assert.equal((await getDoc(shared("conflict"))).data().purchasePrice, 120);
});
test("所有者が異なる家計の金額を移動しない", async () => {
  await seedItem("other", 120, "other-ws");
  await assert.rejects(migrateSharedPurchasePrice(db, "owner-user", "home", "other"));
  assert.equal((await getDoc(shared("other"))).data().purchasePrice, 120);
  assert.equal((await getDoc(backup("other"))).exists(), false);
});
test("同時に処理しても個人保管は1件で金額が失われない", async () => {
  await seedItem("race", 220);
  const results = await Promise.all([migrateSharedPurchasePrice(db, "owner-user", "home", "race"), migrateSharedPurchasePrice(db, "owner-user", "home", "race")]);
  assert.deepEqual([...results].sort(), ["migrated", "no-price"]);
  assert.equal((await getDoc(backup("race"))).data().amount, 220);
  assert.equal(Object.hasOwn((await getDoc(shared("race"))).data(), "purchasePrice"), false);
});
test("不正な金額や家計IDは保管も削除もせず止める", async () => {
  await seedItem("invalid", -1);
  await assert.rejects(migrateSharedPurchasePrice(db, "owner-user", "home", "invalid"), /確認/);
  assert.equal((await getDoc(shared("invalid"))).data().purchasePrice, -1);
  assert.equal((await getDoc(backup("invalid"))).exists(), false);
});
test("個人領域への保存が権限で拒否されても共有側の金額は残る", async () => {
  await seedItem("denied", 320, "friend-ws");
  await assert.rejects(migrateSharedPurchasePrice(db, "housemate", "home", "denied"));
  assert.equal((await getDoc(shared("denied"))).data().purchasePrice, 320);
  const saved = await fetch(`${base}/users/housemate/privatePurchasePrices/home/items/denied`, { headers: { Authorization: "Bearer owner" } });
  assert.equal(saved.status, 404);
});
test("一覧は購入元を確かめ、結果に金額を含めない", async () => {
  await seedItem("list-ready", 500); await seedItem("list-other", 300, "other-ws"); await seedItem("list-invalid", -1);
  await seedItem("list-conflict", 100);
  assert.equal((await request("users/owner-user/privatePurchasePrices/home/items/list-conflict", { amount: num(999), householdId: str("home"), itemId: str("list-conflict"), workspaceId: str("ws") })).status, 200);
  const results = await inspectSharedPurchasePrices(db, "owner-user", "home");
  const map = new Map(results.map(result => [result.itemId, result.status]));
  assert.equal(map.get("list-ready"), "ready"); assert.equal(map.get("list-other"), "other-owner");
  assert.equal(map.get("list-invalid"), "invalid"); assert.equal(map.get("list-conflict"), "backup-conflict");
  assert.ok(results.every(result => !Object.hasOwn(result, "amount")));
});
test("指定した安全な在庫だけ移し、不明・不一致を残す", async () => {
  await seedItem("unselected", 250);
  const result = await migrateSelectedPurchasePrices(db, "owner-user", "home", ["list-ready", "list-other", "list-invalid", "list-conflict", "missing"]);
  assert.deepEqual(result.migrated, ["list-ready"]);
  assert.deepEqual(result.skipped.map(item => item.reason), ["other-owner", "invalid", "backup-conflict", "not-found"]);
  assert.equal((await getDoc(backup("list-ready"))).data().amount, 500);
  assert.equal((await getDoc(shared("list-other"))).data().purchasePrice, 300);
  assert.equal((await getDoc(shared("unselected"))).data().purchasePrice, 250);
  await assert.rejects(migrateSelectedPurchasePrices(db, "owner-user", "home", ["unselected", "unselected"]), /識別子/);
});
test("通信できない場合はキャッシュから点検完了としない", async () => {
  await disableNetwork(db);
  try { await assert.rejects(inspectSharedPurchasePrices(db, "owner-user", "home")); }
  finally { await enableNetwork(db); }
  assert.equal((await getDoc(shared("unselected"))).data().purchasePrice, 250);
});

try {
  const reset = await fetch(`http://${host}/emulator/v1/projects/demo-kurashi/databases/(default)/documents`, { method: "DELETE" });
  if (!reset.ok) throw new Error("エミュレーター初期化失敗");
  assert.equal((await request("households/home", { ownerUid: str("owner-user"), memberUids: { arrayValue: { values: [str("owner-user"), str("housemate")] } } })).status, 200);
  assert.equal((await request("workspaces/ws", { ownerUid: str("owner-user"), memberUids: { arrayValue: { values: [str("owner-user")] } } })).status, 200);
  assert.equal((await request("workspaces/other-ws", { ownerUid: str("other-user"), memberUids: { arrayValue: { values: [str("owner-user"), str("other-user")] } } })).status, 200);
  assert.equal((await request("workspaces/friend-ws", { ownerUid: str("housemate"), memberUids: { arrayValue: { values: [str("owner-user"), str("housemate")] } } })).status, 200);
  const failures = [];
  for (const item of cases) { try { await item.fn(); } catch (error) { failures.push({ name: item.name, message: error.message }); } }
  console.log(JSON.stringify({ suite: "private-price-migration", total: cases.length, passed: cases.length - failures.length, failed: failures.length, ...(failures.length ? { failures } : {}) }));
  if (failures.length) process.exitCode = 1;
} finally {
  await deleteApp(app);
}
