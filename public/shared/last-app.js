/* 「最後に開いていたアプリ」を覚えて、くらしノートを起動したときにそこから始める。
 *
 * 3アプリは1つのアプリ（くらしノート）としてインストールする（2026-09-14 決定）。
 * ホーム画面のアイコンは1つなので、開いたときにどのアプリを出すかを決める必要がある。
 * 書くのは切り替えバー（app-switcher.js）、読むのは起動ページ（/start.html）。
 *
 * 同一オリジンなので localStorage を共有できる。端末ごとの値でよい。
 */

const LAST_APP_KEY = "appSwitcherLast";

/** 起動したときに開くページ。なかみメモは入口ページ（/）ではなく中身（/app）から始める。 */
export const START_URLS = {
  money: "/money/index.html",
  nakami: "/app",
  recipe: "/recipe/index.html",
};

/** まだ何も開いたことがない端末では、お金管理から始める（レシートの確認がここに届くため）。 */
export const DEFAULT_APP = "money";

export function rememberLastApp(id) {
  if (!Object.prototype.hasOwnProperty.call(START_URLS, id)) return;
  try {
    localStorage.setItem(LAST_APP_KEY, id);
  } catch {
    /* 覚えられなくても、次回は既定のアプリから始まるだけなので黙って続ける。 */
  }
}

export function readLastApp() {
  try {
    const id = localStorage.getItem(LAST_APP_KEY);
    return id && Object.prototype.hasOwnProperty.call(START_URLS, id) ? id : DEFAULT_APP;
  } catch {
    return DEFAULT_APP;
  }
}

export function startUrlFor(id) {
  return START_URLS[id] || START_URLS[DEFAULT_APP];
}
