/**
 * 新しい版を出したあとに、画面の飾り（CSS）が全部外れる事故を自分で直す（2026-09-28）。
 *
 * Vercel は新しい版を出すと、前の版の CSS・JS（/_next/static/…、名前に中身の指紋が付く）を消す。
 * 前の版のときに開いていたページを、Chrome がタブの復元などで後から出し直すと、ページは前の版の
 * CSS を読みに行って 404 になり、青いリンクだけの画面になる（ユーザーの実機で起きた。再読み込みで直る）。
 *
 * そこで、ページの頭に小さな処理を直接書き込み、CSS・JS が読めなかったら **1回だけ** 読み込み直す。
 * React が動く前に効かせる必要がある（前の版の JS も消えているので、アプリの中の処理は動かないことがある）。
 * 読み込み直しても直らないとき（本当に CSS が壊れているとき）に止まらなくならないよう、1分に1回までにする。
 */
export const STALE_ASSET_RECOVERY = `(function () {
  var KEY = "kurashi-stale-reload";
  function recentlyReloaded() {
    try { var at = Number(sessionStorage.getItem(KEY)); return Boolean(at) && Date.now() - at < 60000; } catch (e) { return true; }
  }
  function reloadOnce() {
    if (recentlyReloaded()) return;
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch (e) { return; }
    location.reload();
  }
  // 前の版の CSS・JS が読めなかった（404）
  window.addEventListener("error", function (event) {
    var el = event && event.target;
    var url = el && (el.href || el.src) || "";
    if (el && (el.tagName === "LINK" || el.tagName === "SCRIPT") && /\\/_next\\/static\\//.test(url)) reloadOnce();
  }, true);
  // 画面を移るときに、前の版の JS の欠片が読めなかった
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    var text = reason ? String(reason.name) + " " + String(reason.message) : "";
    if (/ChunkLoadError|Loading chunk|Loading CSS chunk/.test(text)) reloadOnce();
  });
  // 念のため：読み終わっても CSS の色の決まり（--brand）が無ければ、CSS が当たっていない
  window.addEventListener("load", function () {
    var brand = getComputedStyle(document.documentElement).getPropertyValue("--brand");
    if (!brand || !String(brand).trim()) reloadOnce();
  });
})();`;
