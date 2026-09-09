#!/usr/bin/env node
/**
 * 同居させた3アプリが「ページとして」正しく配信されるかを確かめる。
 *
 * なぜこれが要るか:
 *   最初の検証では /money が 200 を返すことしか見ておらず、ページを開いていなかった。
 *   その結果 rewrite でURLが /money のままになり、HTML内の相対パス styles.css が
 *   /money/styles.css ではなく /styles.css に解決されて全部404、という事故を見逃した。
 *   ステータスコードではなく、ブラウザと同じ手順で相対URLを解決して取りに行く。
 *
 * 使い方: BASE=http://127.0.0.1:3000 node serving-check.mjs
 */

const BASE = process.env.BASE || "http://127.0.0.1:3000";

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log("OK   " + name); }
  else { failures.push(name + (detail ? "  →  " + detail : "")); console.log("失敗 " + name + (detail ? "  →  " + detail : "")); }
}

/** HTML から、ブラウザが実際に取りに行くローカルURLを拾う。 */
function localRefsOf(html) {
  const refs = new Set();
  const add = (value) => {
    if (!value) return;
    if (/^(https?:)?\/\//.test(value)) return;   // 外部
    if (/^(data|blob|mailto|tel):/.test(value)) return;
    if (value.startsWith("#")) return;           // ページ内アンカー
    refs.add(value);
  };
  for (const m of html.matchAll(/<(?:link|script|img)\b[^>]*?\b(?:href|src)="([^"]+)"/g)) add(m[1]);
  // <script type="module"> の中の import("...") と from "..."
  for (const m of html.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) add(m[1]);
  for (const m of html.matchAll(/from\s+["'](\.[^"']+)["']/g)) add(m[1]);
  return [...refs];
}

const EXPECTED_TYPE = [
  [/\.css(\?|$)/, "text/css"],
  [/\.js(\?|$)/, "javascript"],
  [/\.(webmanifest|json)(\?|$)/, "json"],
  [/\.png(\?|$)/, "image/png"],
  [/\.svg(\?|$)/, "image/svg"],
];

async function checkPage(label, path, mustContain) {
  const response = await fetch(BASE + path, { redirect: "follow" });
  const finalUrl = response.url;
  check(`${label}: ページが開ける`, response.ok, `${response.status} ${finalUrl}`);
  if (!response.ok) return;

  const html = await response.text();
  for (const needle of mustContain) {
    check(`${label}: ${needle} を含む`, html.includes(needle));
  }

  const refs = localRefsOf(html);
  check(`${label}: 参照するローカルファイルが見つかる`, refs.length > 0, `${refs.length}件`);

  let bad = 0;
  for (const ref of refs) {
    // ブラウザと同じ解決。ここが rewrite だと狂う。
    const resolved = new URL(ref, finalUrl);
    const res = await fetch(resolved, { redirect: "follow" });
    const type = res.headers.get("content-type") || "";
    let typeOk = true;
    for (const [pattern, expected] of EXPECTED_TYPE) {
      if (pattern.test(ref)) { typeOk = type.includes(expected); break; }
    }
    if (!res.ok || !typeOk) {
      bad += 1;
      console.log(`     ✗ ${ref}  →  ${resolved.pathname}  ${res.status} ${type}`);
    }
  }
  check(`${label}: 参照ファイルが全部200で正しい種類`, bad === 0, bad ? `${bad}件が取れない` : "");
}

await checkPage("お金管理 /money", "/money", [
  "お金管理",
  'data-page="records"',
  "receipt-modal",
]);

await checkPage("つくりおきノート /recipe", "/recipe", [
  "つくりおきノート",
  "app-switcher",
]);

await checkPage("なかみメモ /", "/", []);

// 共有アセットは3アプリから同じURLで引かれる
for (const path of ["/shared/app-switcher.js", "/shared/app-switcher.css"]) {
  const res = await fetch(BASE + path);
  check(`共有アセット ${path}`, res.ok, String(res.status));
}

// 画像APIは未認証を弾く
const api = await fetch(BASE + "/api/images/upload", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
check("画像API: 未認証は401か400で弾く", api.status === 401 || api.status === 400, String(api.status));

console.log(`\n合計 ${pass + failures.length} 件 ／ 成功 ${pass} ／ 失敗 ${failures.length}`);
if (failures.length) { failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
