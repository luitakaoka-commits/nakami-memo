#!/usr/bin/env node
/**
 * くらしノートのアイコン（public/icons/kurashi-note.svg）から、インストール用の PNG を作る。
 *
 * 実行: node scripts/render-icons.mjs
 * （初回だけ npx playwright install chromium が要る）
 *
 * 作るもの
 *   kurashi-note-192.png          通常のアイコン（角丸・角は透明）
 *   kurashi-note-512.png          同上
 *   kurashi-note-maskable-512.png Android がマスクで切り抜く用（全面を塗る）
 *   kurashi-note-apple-180.png    iPhone のホーム画面用（全面を塗る。角丸は iOS が付ける）
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ICONS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const svg = await readFile(path.join(ICONS, "kurashi-note.svg"), "utf8");

/* 通常のアイコンは角を丸めて角を透明にする。ランチャーによっては四角のまま出すため。 */
const OUTPUTS = [
  { file: "kurashi-note-192.png", size: 192, radius: 0.22 },
  { file: "kurashi-note-512.png", size: 512, radius: 0.22 },
  { file: "kurashi-note-maskable-512.png", size: 512, radius: 0 },
  { file: "kurashi-note-apple-180.png", size: 180, radius: 0 },
];

const browser = await chromium.launch();
try {
  for (const { file, size, radius } of OUTPUTS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">` +
      `<div style="width:${size}px;height:${size}px;border-radius:${Math.round(size * radius)}px;overflow:hidden">` +
      svg.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `) +
      `</div></body></html>`,
    );
    await page.screenshot({ path: path.join(ICONS, file), omitBackground: true });
    await page.close();
    console.log("作成: public/icons/" + file);
  }
} finally {
  await browser.close();
}
