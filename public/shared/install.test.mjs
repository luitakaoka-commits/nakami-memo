/* 3アプリを「くらしノート」1つとしてインストールする設定の確認（2026-09-14）。
 *
 * どれか1つのページが別の manifest を指していると、そのページからは別のアプリとしてインストールされ、
 * ホーム画面にアイコンが増える。ブラウザで試さないと気づけないので、ここで固定する。
 * 実際にインストールできるか（Chrome の判定）は install-check.mjs が本物のブラウザで見る。
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC = path.join(ROOT, "public");

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

/** PNG の幅と高さ（IHDR チャンク）を読む。 */
function pngSize(file) {
  const buf = readFileSync(file);
  ok(buf.readUInt32BE(0) === 0x89504e47, `${file} が PNG ではない`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

const manifest = JSON.parse(readFileSync(path.join(PUBLIC, "manifest.webmanifest"), "utf8"));

t("manifest: 名前・id・範囲・起動ページ", () => {
  eq(manifest.name, "くらしノート", "name");
  eq(manifest.id, "/", "id（変えると別のアプリ扱いになり、入れ直しが要る）");
  eq(manifest.scope, "/", "scope（3アプリ全部を含む）");
  eq(manifest.start_url, "/start.html", "start_url");
  eq(manifest.display, "standalone", "display");
  ok(existsSync(path.join(PUBLIC, "start.html")), "start.html がない");
});

t("manifest: アイコンが揃っていて、書いてある大きさと実物が一致する", () => {
  const want = [["192x192", "any"], ["512x512", "any"], ["512x512", "maskable"]];
  for (const [sizes, purpose] of want) {
    const icon = manifest.icons.find((i) => i.sizes === sizes && i.purpose === purpose);
    ok(icon, `${sizes} ${purpose} のアイコンがない`);
    const [w, h] = pngSize(path.join(PUBLIC, icon.src));
    eq(`${w}x${h}`, sizes, icon.src);
  }
  eq(pngSize(path.join(PUBLIC, "icons", "kurashi-note-apple-180.png")), [180, 180], "iPhone 用");
});

const pages = {
  "お金管理": readFileSync(path.join(PUBLIC, "money", "index.html"), "utf8"),
  "つくりおきノート": readFileSync(path.join(PUBLIC, "recipe", "index.html"), "utf8"),
  "起動ページ": readFileSync(path.join(PUBLIC, "start.html"), "utf8"),
};

t("3アプリのページがすべて共通の manifest を指す", () => {
  for (const [name, html] of Object.entries(pages)) {
    const links = [...html.matchAll(/<link[^>]*rel="manifest"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    eq(links, ["/manifest.webmanifest"], name);
  }
  const layout = readFileSync(path.join(ROOT, "src", "app", "layout.tsx"), "utf8");
  ok(/manifest:\s*"\/manifest\.webmanifest"/.test(layout), "なかみメモ（layout.tsx）が共通の manifest を指していない");
});

t("iPhone でホーム画面に追加したときの名前とアイコンも共通", () => {
  for (const [name, html] of Object.entries(pages)) {
    ok(html.includes('href="/icons/kurashi-note-apple-180.png"'), `${name} の apple-touch-icon`);
    ok(html.includes('content="くらしノート"'), `${name} の apple-mobile-web-app-title`);
  }
  const layout = readFileSync(path.join(ROOT, "src", "app", "layout.tsx"), "utf8");
  ok(layout.includes("/icons/kurashi-note-apple-180.png") && layout.includes('title: "くらしノート"'), "なかみメモ（layout.tsx）");
});

t("アプリごとの古い manifest が残っていない（残るとそこから別アプリとして入る）", () => {
  ok(!existsSync(path.join(PUBLIC, "money", "manifest.json")), "public/money/manifest.json");
  ok(!existsSync(path.join(PUBLIC, "recipe", "manifest.webmanifest")), "public/recipe/manifest.webmanifest");
});

/* ---------- 最後に開いていたアプリから始める ---------- */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
const last = await import("./last-app.js");

t("起動ページの行き先が実在するページを指す", () => {
  ok(existsSync(path.join(PUBLIC, "money", "index.html")), "money");
  ok(existsSync(path.join(PUBLIC, "recipe", "index.html")), "recipe");
  ok(existsSync(path.join(ROOT, "src", "app", "app", "page.tsx")), "なかみメモ /app");
  eq(last.START_URLS, { money: "/money/index.html", nakami: "/app", recipe: "/recipe/index.html" }, "行き先");
});

t("初めて開く端末ではお金管理から始まる", () => {
  store.clear();
  eq(last.startUrlFor(last.readLastApp()), "/money/index.html", "既定");
});

t("最後に開いたアプリを覚えて、そこから始まる", () => {
  last.rememberLastApp("recipe");
  eq(last.startUrlFor(last.readLastApp()), "/recipe/index.html", "recipe");
  last.rememberLastApp("nakami");
  eq(last.startUrlFor(last.readLastApp()), "/app", "nakami");
});

t("知らない値は覚えず、壊れた値が入っていても既定に戻る", () => {
  last.rememberLastApp("nakami");
  last.rememberLastApp("evil");
  eq(last.readLastApp(), "nakami", "知らない値で上書きしない");
  store.set("appSwitcherLast", "javascript:alert(1)");
  eq(last.startUrlFor(last.readLastApp()), "/money/index.html", "壊れた値");
});

t("localStorage が使えなくても落ちない", () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  try {
    last.rememberLastApp("recipe");
    eq(last.readLastApp(), "money", "既定に戻る");
  } finally {
    globalThis.localStorage = saved;
  }
});

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
