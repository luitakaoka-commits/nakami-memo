#!/usr/bin/env node
/**
 * 3アプリのどのページからでも「くらしノート」1つとしてインストールできるかを、本物の Chrome に判定させる。
 *
 * install.test.mjs はファイルの中身を読むだけなので、Chrome が実際にインストール可能と判断するか
 * （manifest を読めるか、アイコンを取れるか、など）はここで見る。
 * Chrome DevTools Protocol の Page.getInstallabilityErrors は、インストールのボタンが出ない理由を返す。
 *
 * 使い方: npm run build && npm start のあと
 *   BASE=http://127.0.0.1:3000 node public/shared/install-check.mjs
 * （初回だけ npx playwright install chromium が要る）
 */
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://127.0.0.1:3000";

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log("OK   " + name); }
  else { failures.push(name); console.log("失敗 " + name + (detail ? "  →  " + detail : "")); }
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

  for (const [label, path] of [["お金管理", "/money"], ["つくりおきノート", "/recipe"], ["なかみメモ", "/"]]) {
    const page = await context.newPage();
    await page.goto(BASE + path, { waitUntil: "load" });
    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send("Page.getAppManifest");
    check(`${label}: 共通の manifest を読む`, (manifest.url || "").endsWith("/manifest.webmanifest"), manifest.url);
    check(`${label}: Chrome が manifest を読み違えていない`, !(manifest.errors || []).length, JSON.stringify(manifest.errors));

    // Chrome のインストール条件（web.dev「install criteria」）を、Chrome が実際に取得した manifest で確かめる。
    // Page.getInstallabilityErrors は headless では manifest が無いページでも空を返し、判定に使えなかった。
    const data = JSON.parse(manifest.data || "{}");
    const base = new URL(manifest.url || BASE);
    const scope = new URL(data.scope || "./", base).href;
    const start = new URL(data.start_url || "", base).href;
    check(`${label}: 名前・起動ページ・表示方法がそろっている`,
      Boolean(data.name || data.short_name) && start.startsWith(scope) && ["standalone", "fullscreen", "minimal-ui"].includes(data.display),
      JSON.stringify({ name: data.name, start, scope, display: data.display }));
    const sizes = await page.evaluate(async (icons) => Promise.all(icons.map((icon) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`);
      img.onerror = () => resolve("読み込めない");
      img.src = icon;
    }))), (data.icons || []).map((icon) => new URL(icon.src, base).href));
    check(`${label}: 192px と 512px のアイコンが実際に読み込める`,
      sizes.includes("192x192") && sizes.includes("512x512") && !sizes.includes("読み込めない"), sizes.join(", "));
    await page.close();
  }

  // 起動ページ：最後に開いたアプリへ移る
  const fresh = await browser.newContext();
  const first = await fresh.newPage();
  await first.goto(BASE + "/start.html");
  await first.waitForURL(/\/money\/index\.html$/, { timeout: 10000 }).catch(() => {});
  check("起動ページ: 初めての端末ではお金管理へ移る", first.url().endsWith("/money/index.html"), first.url());

  await first.goto(BASE + "/recipe/index.html", { waitUntil: "load" });
  await first.waitForFunction(() => localStorage.getItem("appSwitcherLast") === "recipe", null, { timeout: 10000 }).catch(() => {});
  await first.goto(BASE + "/start.html");
  await first.waitForURL(/\/recipe\/index\.html$/, { timeout: 10000 }).catch(() => {});
  check("起動ページ: 最後に開いたつくりおきノートへ移る", first.url().endsWith("/recipe/index.html"), first.url());
  await fresh.close();
} finally {
  await browser.close();
}

console.log(`\n合計 ${pass + failures.length} 件 ／ 成功 ${pass} ／ 失敗 ${failures.length}`);
process.exit(failures.length ? 1 : 0);
