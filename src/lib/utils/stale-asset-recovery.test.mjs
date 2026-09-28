/* 新しい版を出したあとに CSS が外れた画面を、自分で1回だけ読み込み直す処理の確認（2026-09-28）。
 * 実行: node --experimental-strip-types src/lib/utils/stale-asset-recovery.test.mjs（npm test から呼ばれる）
 * 本物のブラウザでも確かめた（最初だけ CSS が 404 → 1回読み込み直して飾りが戻る。ずっと 404 → 1回で止まる）。
 */
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { STALE_ASSET_RECOVERY } from "./stale-asset-recovery.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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

/** 作り物のブラウザ。読み込み直した回数を数える */
function browser({ brand = "#1e8a58", now = 1_000_000, storage = new Map() } = {}) {
  const listeners = {};
  const env = {
    reloads: 0,
    storage,
    window: { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } },
    fire: (type, event = {}) => (listeners[type] || []).forEach((fn) => fn(event)),
  };
  const context = {
    window: env.window,
    document: { documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: () => brand }),
    sessionStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
    location: { reload: () => { env.reloads += 1; } },
    Date: { now: () => now },
    Number, String, Boolean,
  };
  vm.runInNewContext(STALE_ASSET_RECOVERY, context);
  return env;
}

const cssLink = { tagName: "LINK", href: "https://nakami-memo.vercel.app/_next/static/css/old.css" };

t("前の版の CSS が読めなかったら、1回だけ読み込み直す", () => {
  const env = browser();
  env.fire("error", { target: cssLink });
  eq(env.reloads, 1, "読み込み直した");
});

t("読み込み直しても直らないときは、1分のあいだは読み込み直さない（止まらなくならない）", () => {
  const storage = new Map();
  const first = browser({ storage, now: 1_000_000 });
  first.fire("error", { target: cssLink });
  const second = browser({ storage, now: 1_000_000 + 5_000 });
  second.fire("error", { target: cssLink });
  eq(first.reloads + second.reloads, 1, "2回目は読み込み直さない");
  const later = browser({ storage, now: 1_000_000 + 120_000 });
  later.fire("error", { target: cssLink });
  eq(later.reloads, 1, "時間がたてば、また直せる");
});

t("前の版の JS の欠片が読めなかったときも、読み込み直す", () => {
  const env = browser();
  env.fire("unhandledrejection", { reason: { name: "ChunkLoadError", message: "Loading chunk 123 failed." } });
  eq(env.reloads, 1, "読み込み直した");
});

t("読み終わっても CSS の色の決まりが無ければ、読み込み直す", () => {
  const env = browser({ brand: "" });
  env.fire("load");
  eq(env.reloads, 1, "飾りが当たっていない");
});

t("ふつうのときは何もしない", () => {
  const env = browser();
  env.fire("load");
  env.fire("error", { target: { tagName: "IMG", src: "https://example.com/a.png" } });
  env.fire("error", { target: { tagName: "SCRIPT", src: "https://www.gstatic.com/firebasejs/x.js" } });
  env.fire("unhandledrejection", { reason: { name: "FirebaseError", message: "permission-denied" } });
  eq(env.reloads, 0, "読み込み直さない");
});

t("この処理はページの頭に直接書き込まれている（アプリの JS が読めなくても効くように）", () => {
  const layout = readFileSync(path.join(ROOT, "src", "app", "layout.tsx"), "utf8");
  ok(/<head>[\s\S]*dangerouslySetInnerHTML=\{\{ __html: STALE_ASSET_RECOVERY \}\}[\s\S]*<\/head>/.test(layout), "layout.tsx の head に入っていない");
});

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
