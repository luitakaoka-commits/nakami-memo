/* 同居人との共有（「家」）の、ネットワークを使わない部分の確認（2026-09-28）。
 * 実行: node --experimental-strip-types src/lib/household/household-core.test.mjs（npm test から呼ばれる）
 */
import {
  HOUSEHOLD_COLLECTIONS, INVITE_DAYS, OUTCOME_QUEUE, copyMismatches, defaultHouseholdName, inviteExpiry, inviteLink,
  inviteStatus, newInviteCode, outcomeQueueEntry, shouldQueueOutcome, spaceSegments,
} from "./household-core.ts";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { receiptLinePatches, itemOutcomePatch } from "../inventory/outcome-core.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const finance = createRequire(import.meta.url)(path.join(ROOT, "public", "money", "finance-engine.js"));

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

const NOW = new Date("2026-09-28T03:00:00.000Z").getTime();

t("家に入っていなければ本人の場所、入っていれば家の場所", () => {
  eq(spaceSegments("u1", null), ["users", "u1"], "家なし");
  eq(spaceSegments("u1", ""), ["users", "u1"], "空文字も家なし");
  eq(spaceSegments("u1", "h1"), ["households", "h1"], "家あり");
});

t("家に写すのは、なかみメモとつくりおきノートのデータだけ（お金管理は写さない）", () => {
  eq([...HOUSEHOLD_COLLECTIONS], ["areas", "locations", "items", "tools", "consumptions", "recipes", "plans", "shopping"], "一覧");
  ok(!HOUSEHOLD_COLLECTIONS.some((name) => ["receipts", "receiptItems", "transactions"].includes(name)), "お金管理が混ざっている");
});

t("招待コードは推測しにくい24文字（紛らわしい文字 0・O・1・l・I は使わない）", () => {
  let n = 0;
  const code = newInviteCode(() => (n++ * 37) % 256);
  eq(code.length, 24, "長さ");
  ok(/^[a-zA-Z2-9]+$/.test(code), `使える文字だけ: ${code}`);
  ok(!/[0O1lI]/.test(code), `紛らわしい文字が入っている: ${code}`);
  let m = 0;
  ok(newInviteCode(() => (m++ * 91) % 256) !== code, "乱数が違えば違うコード");
});

t("招待リンクと期限", () => {
  eq(inviteLink("https://nakami-memo.vercel.app/", "abc"), "https://nakami-memo.vercel.app/app/join?code=abc", "リンク");
  eq(inviteExpiry(NOW) - NOW, INVITE_DAYS * 86_400_000, "7日");
});

t("招待コードの状態：無い・期限切れ・使える", () => {
  eq(inviteStatus(null, NOW), "missing", "無い");
  eq(inviteStatus({ householdId: "" , expiresAtMillis: NOW + 1 }, NOW), "missing", "家が空");
  eq(inviteStatus({ householdId: "h1", expiresAtMillis: NOW }, NOW), "expired", "ちょうど切れた");
  eq(inviteStatus({ householdId: "h1", expiresAtMillis: NOW + 1000 }, NOW), "ok", "使える");
});

t("家の名前の初期値", () => {
  eq(defaultHouseholdName("山田"), "山田さんの家", "名前あり");
  eq(defaultHouseholdName(""), "わが家", "名前なし");
});

t("写した件数の突き合わせ：そろっていないコレクションだけを返す", () => {
  const source = { areas: 2, locations: 4, items: 54, recipes: 1 };
  eq(copyMismatches(source, { ...source }), [], "全部そろった");
  eq(copyMismatches(source, { ...source, items: 53 }), ["items"], "1件足りない");
});

t("お金管理へ返すのは、家に入っていてレシートから来た在庫だけ（決定 B）", () => {
  ok(shouldQueueOutcome("h1", { purchaseWorkspaceId: "ws1" }), "家あり・レシート由来");
  ok(shouldQueueOutcome("h1", { purchaseRef: "r1#1" }), "古い在庫（共有スペース不明）も受け渡す");
  ok(!shouldQueueOutcome("h1", {}), "手で足した在庫は返す先が無い");
  ok(!shouldQueueOutcome(null, { purchaseWorkspaceId: "ws1" }), "家なしは今までどおり直接書く");
  eq(OUTCOME_QUEUE, "outcomeQueue", "受け渡し箱の名前（ルールと同じ）");
});

t("受け渡し箱の1件", () => {
  const patch = itemOutcomePatch({ kind: "discarded", reason: "期限切れ" }, new Date(NOW));
  eq(outcomeQueueEntry({ id: "i1", name: "もやし", purchaseWorkspaceId: "ws1" }, patch, "mate"), {
    inventoryItemId: "i1", purchaseWorkspaceId: "ws1", outcome: "expired", outcomeAt: "2026-09-28T03:00:00.000Z",
    outcomeReason: "期限切れ", recordedBy: "mate", itemName: "もやし",
  }, "中身");
});

t("同居人が押した分を、お金管理が明細に返す計算は、なかみメモが直接返す計算と同じ（誰が押してもムダ支出が同じ）", () => {
  const cases = [
    [{ id: "a", receiptId: "r1", amount: 198 }, { id: "b", receiptId: "r1", amount: -50 }],
    [{ id: "a", receiptId: "r1", amount: 98 }, { id: "b", receiptId: "r2", amount: 98 }, { id: "c", receiptId: "r2", amount: -20 }],
    [{ id: "a", receiptId: "r1", amount: 199 }],
    [],
  ];
  const choices = [{ kind: "discarded", reason: "期限切れ" }, { kind: "discarded", reason: "買いすぎ" }, { kind: "consumed" }];
  cases.forEach((lines, i) => choices.forEach((choice) => {
    const patch = itemOutcomePatch(choice, new Date(NOW));
    const direct = receiptLinePatches(lines, patch);
    const viaQueue = finance.outcomeLinePatches(lines, outcomeQueueEntry({ id: "i", purchaseWorkspaceId: "ws" }, patch, "mate"));
    eq(viaQueue, direct, `ケース${i + 1}・${choice.reason || "使い切った"}`);
  }));
});

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
