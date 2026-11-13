/* LINE の中のブラウザで開かれたら、ふだんのブラウザで開き直す（open-external.js。2026-11-14）の確認。
 * 実行: node public/shared/open-external.test.mjs（npm test から呼ばれる） */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), "utf8");
const source = read("public", "shared", "open-external.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("失敗 " + name + "  →  " + (e.message || e)); }
}
function ok(cond, label) { if (!cond) throw new Error(label); }

/** その端末・そのURLで動かし、開き直した先（無ければ null）を返す */
function run(userAgent, href) {
  let replaced = null;
  vm.runInNewContext(source, { navigator: { userAgent }, location: { href, replace: (to) => { replaced = to; } }, URL });
  return replaced;
}

const LINE = "Mozilla/5.0 (Linux; Android 15; SM-S938Q) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36 Line/15.17.1/IAB";
const CHROME = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

t("LINE の中で開かれたら、openExternalBrowser=1 を付けて開き直す", () => {
  eq(run(LINE, "https://nakami-memo.vercel.app/app"), "https://nakami-memo.vercel.app/app?openExternalBrowser=1");
  eq(run(LINE, "https://nakami-memo.vercel.app/app/search?q=牛乳#top"), "https://nakami-memo.vercel.app/app/search?q=%E7%89%9B%E4%B9%B3&openExternalBrowser=1#top");
});

t("印が付いていれば開き直さない（繰り返さない）", () => {
  eq(run(LINE, "https://nakami-memo.vercel.app/app?openExternalBrowser=1"), null);
});

t("ふだんのブラウザでは何もしない", () => {
  eq(run(CHROME, "https://nakami-memo.vercel.app/app"), null);
  eq(run("Mozilla/5.0 Online/1.0", "https://nakami-memo.vercel.app/app"), null);
});

t("4アプリと入口のページが、ほかの処理より先に読んでいる", () => {
  const pages = [["public", "money", "index.html"], ["public", "recipe", "index.html"], ["public", "consult", "index.html"], ["public", "start.html"]];
  for (const page of pages) {
    const html = read(...page);
    const at = html.indexOf('<script src="/shared/open-external.js"></script>');
    ok(at > 0, `${page.join("/")} が読んでいない`);
    const firstOther = html.search(/<script(?! src="\/shared\/open-external\.js")/);
    ok(firstOther === -1 || firstOther > at, `${page.join("/")} でほかの script より後にある`);
  }
  ok(read("src", "app", "layout.tsx").includes('<script src="/shared/open-external.js" />'), "なかみメモ（layout.tsx）が読んでいない");
});

function eq(actual, expected) {
  if (actual !== expected) throw new Error(`期待 ${expected} / 実際 ${actual}`);
}

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
