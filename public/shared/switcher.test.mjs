/* アプリ切り替えバー／シートの動作確認。jsdom 上で実際に描画して確かめる。 */
import { JSDOM } from "jsdom";
import { pathToFileURL } from "node:url";
import path from "node:path";

const SHARED = process.env.SHARED_DIR;
if (!SHARED) throw new Error("SHARED_DIR を指定してください");

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

const dom = new JSDOM("<!doctype html><html><head></head><body><div id='app'></div></body></html>", {
  url: "https://example.test/money",
  pretendToBeVisual: true,
});
const { window } = dom;
global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.HTMLElement = window.HTMLElement;

const mod = await import(pathToFileURL(path.join(SHARED, "app-switcher.js")).href);
const { mountAppSwitcher, publishAppStatus, APPS, appIconMarkup } = mod;

// --- バー ---
t("3アプリが定義されている", () => eq(APPS.map((a) => a.id), ["money", "nakami", "recipe"], "id"));
t("リンク先が正しい", () => eq(APPS.map((a) => a.href), ["/money", "/", "/recipe"], "href"));

const bar = mountAppSwitcher({ current: "money" });
t("バーが body の先頭に入る", () => ok(document.body.firstChild === bar, "先頭でない"));
t("バーに現在のアプリ名が出る", () => ok(bar.textContent.includes("お金管理"), bar.textContent));
t("バーのアイコンが現在のアプリのもの", () => ok(bar.querySelector(".appsw-tile--money"), "money タイルがない"));
t("トリガーがボタンで、ダイアログを開くと宣言している", () => {
  const b = bar.querySelector(".appsw-trigger");
  ok(b && b.tagName === "BUTTON", "button でない");
  eq(b.getAttribute("aria-haspopup"), "dialog", "aria-haspopup");
});

// --- シート ---
function openSheet() {
  bar.querySelector(".appsw-trigger").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  return document.querySelector(".appsw-backdrop");
}

let sheet = openSheet();
t("シートが開く", () => ok(sheet, "backdrop がない"));
t("ダイアログとして宣言されている", () => {
  const d = sheet.querySelector(".appsw-sheet");
  eq(d.getAttribute("role"), "dialog", "role");
  eq(d.getAttribute("aria-modal"), "true", "aria-modal");
});
t("3行ぶん出る", () => eq(sheet.querySelectorAll(".appsw-row").length, 3, "行数"));
t("3行それぞれに固有のアイコンが付く", () => {
  const tiles = [...sheet.querySelectorAll(".appsw-row .appsw-tile")].map((el) => el.className.split("--")[1]);
  eq(tiles, ["money", "nakami", "recipe"], "アイコン");
});
t("現在のアプリはリンクではなく「今ここ」が付く", () => {
  const rows = [...sheet.querySelectorAll(".appsw-row")];
  eq(rows[0].tagName, "DIV", "現在行のタグ");
  eq(rows[0].getAttribute("aria-current"), "page", "aria-current");
  ok(rows[0].textContent.includes("今ここ"), "今ここ がない");
});
t("他の2つはリンクで、正しい行き先を持つ", () => {
  const rows = [...sheet.querySelectorAll(".appsw-row")];
  eq(rows[1].tagName, "A", "なかみメモのタグ");
  eq(rows[1].getAttribute("href"), "/", "なかみメモの href");
  eq(rows[2].tagName, "A", "つくりおきのタグ");
  eq(rows[2].getAttribute("href"), "/recipe", "つくりおきの href");
  ok(!rows[1].textContent.includes("今ここ") && !rows[2].textContent.includes("今ここ"), "今ここ が余計に付いている");
});
t("状態がまだ書かれていない間は状態行を出さない", () => eq(sheet.querySelectorAll(".appsw-state").length, 0, "状態行数"));

t("Escape で閉じる", () => {
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok(!document.querySelector(".appsw-backdrop"), "閉じていない");
});

t("背景クリックで閉じる", () => {
  const s = openSheet();
  s.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  ok(!document.querySelector(".appsw-backdrop"), "閉じていない");
});

t("二重に開かない", () => {
  openSheet();
  openSheet();
  eq(document.querySelectorAll(".appsw-backdrop").length, 1, "backdrop 数");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});

// --- 状態表示 ---
t("他アプリが書いた状態が表示される", () => {
  publishAppStatus("recipe", "今週の献立 未設定");
  publishAppStatus("nakami", "期限が近い 3件");
  const s = openSheet();
  const states = [...s.querySelectorAll(".appsw-row")].map((r) => {
    const el = r.querySelector(".appsw-state");
    return el ? el.textContent : "";
  });
  eq(states, ["", "期限が近い 3件", "今週の献立 未設定"], "状態行");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});

t("古すぎる状態は出さない", () => {
  const raw = JSON.parse(localStorage.getItem("appSwitcherStatus"));
  raw.nakami.at = Date.now() - 1000 * 60 * 60 * 24 * 4;
  localStorage.setItem("appSwitcherStatus", JSON.stringify(raw));
  const s = openSheet();
  const row = s.querySelectorAll(".appsw-row")[1];
  ok(!row.querySelector(".appsw-state"), "4日前の状態が残っている");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});

t("状態のテキストはエスケープされる", () => {
  publishAppStatus("recipe", '<img src=x onerror=alert(1)>');
  const s = openSheet();
  const el = s.querySelectorAll(".appsw-row")[2].querySelector(".appsw-state");
  ok(el && !el.querySelector("img"), "HTMLとして解釈されている");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});

t("localStorage が使えなくても落ちない", () => {
  const original = window.localStorage.getItem;
  window.localStorage.getItem = () => { throw new Error("blocked"); };
  try {
    const s = openSheet();
    ok(s, "シートが開かない");
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  } finally {
    window.localStorage.getItem = original;
  }
});

t("マウント時に window.__appStatus が用意される", () => {
  ok(typeof window.__appStatus === "function", "__appStatus が関数でない");
});

t("__appStatus で書いた内容が、自分のアプリの状態として保存される", () => {
  window.__appStatus("今使える 12,400円");
  const saved = JSON.parse(localStorage.getItem("appSwitcherStatus"));
  eq(saved.money.text, "今使える 12,400円", "money の状態");
});

t("自分のアプリの行には状態を出さない（今ここ なので不要）", () => {
  const s = openSheet();
  const row = s.querySelectorAll(".appsw-row")[0];
  ok(!row.querySelector(".appsw-state"), "自分の行に状態が出ている");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});

t("長すぎる状態は切り詰められる", () => {
  window.__appStatus("あ".repeat(100));
  const saved = JSON.parse(localStorage.getItem("appSwitcherStatus"));
  ok(saved.money.text.length <= 40, "長さ " + saved.money.text.length);
});

t("アイコンのSVGが3種とも組み立てられる", () => {
  for (const id of ["money", "nakami", "recipe"]) {
    const html = appIconMarkup(id, 26);
    ok(html.includes("<svg") && html.includes("appsw-tile--" + id), id + " のアイコン");
  }
});

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
