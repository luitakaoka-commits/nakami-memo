/* LINE の中のブラウザで開かれたら、ふだんのブラウザ（Chrome・Safari）で開き直す（2026-11-14）。
 *
 * LINE で共有したリンクを押すと、LINE の中のブラウザで開く。そこでは Google のログインが通らず、
 * 「Unable to process request due to missing initial state」で止まった（ユーザーの実機。中のブラウザは
 * 保存領域が仕切られていて、ログインの途中の情報が消える。Google も中のブラウザでのログインを断っている）。
 *
 * LINE は、URL に openExternalBrowser=1 が付いていると、ふだんのブラウザで開く（LINE の公式の仕組み）。
 * そこで LINE の中だと分かったら、その印を付けて開き直す。印が付いていれば何もしないので、繰り返さない。
 * ログインより前に効かせるため、4アプリともページの頭で（ほかの処理より先に）読む。
 */
(function () {
  try {
    var ua = navigator.userAgent || "";
    if (!/\bLine\//i.test(ua)) return;
    var url = new URL(location.href);
    if (url.searchParams.get("openExternalBrowser") === "1") return;
    url.searchParams.set("openExternalBrowser", "1");
    location.replace(url.toString());
  } catch (error) {
    /* 開き直せなくても、ページはそのまま出す */
  }
})();
