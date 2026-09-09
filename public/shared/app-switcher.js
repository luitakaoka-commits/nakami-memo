/* 3アプリ共通のアプリ切り替え。
 *
 *   /          なかみメモ（Next.js本体）
 *   /money/    お金管理
 *   /recipe/   つくりおきノート
 *
 * 同一オリジンに同居しているので、このファイル1つを3アプリから読み込んでいる。
 * なかみメモ（React）側も、同じマークアップ・同じCSSクラスで描いている。
 *
 * アイコンは「家計簿」「在庫」「レシピ」の一般的な記号ではなく、
 * そのアプリが実際に測っているものを描いている。並べたとき役割が一目で分かるようにするため。
 *   お金管理       … 残量ゲージ（今いくら使ってよいか）
 *   なかみメモ     … 蓋がずれた箱（中身が見えるのが要点）
 *   つくりおきノート … 蓋つきの保存容器（調理中の鍋ではなく、しまっておく器）
 */

const STATUS_KEY = "appSwitcherStatus";
/* 状態表示が古すぎると誤解を招くので、この時間を過ぎたら出さない。 */
const STATUS_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;

export const APPS = [
  { id: "money", name: "お金管理", href: "/money" },
  { id: "nakami", name: "なかみメモ", href: "/" },
  { id: "recipe", name: "つくりおきノート", href: "/recipe" },
];

const ICONS = {
  money:
    '<path d="M3 13.5a7 7 0 0 1 14 0" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round"/>' +
    '<path d="M10 13.5 13.6 8.9" stroke="#e2705f" stroke-width="1.9" stroke-linecap="round"/>' +
    '<circle cx="10" cy="13.5" r="1.35" fill="#ffffff"/>',
  nakami:
    '<rect x="3.6" y="9.2" width="12.8" height="7.4" rx="1.4" stroke="#ffffff" stroke-width="1.8"/>' +
    '<path d="M2.6 7.4 17.4 5.6l.5 3.1-14.8 1.8z" fill="#ffffff"/>' +
    '<path d="M8.4 12.4h3.2" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round"/>',
  recipe:
    '<path d="M4.6 9.6h10.8v3.1a3.6 3.6 0 0 1-3.6 3.6H8.2a3.6 3.6 0 0 1-3.6-3.6z" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path d="M3 8.2h14" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M10 5.2v1.6" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>',
};

/** アプリのアイコンタイル。size は 26（バー）か 36（シート）を想定。 */
export function appIconMarkup(id, size) {
  const inner = ICONS[id] || "";
  const glyph = Math.round(size * 0.78);
  return (
    '<span class="appsw-tile appsw-tile--' + id + '" aria-hidden="true">' +
    '<svg width="' + glyph + '" height="' + glyph + '" viewBox="0 0 20 20" fill="none">' + inner + "</svg>" +
    "</span>"
  );
}

/* ---------- 各アプリの「今の状態」 ---------- */

/* 3アプリは同じオリジンなので localStorage を共有できる。
   Firestoreを跨いで読むにはFirebaseプロジェクトの統合が要るが、
   「最後に開いたときの状態」を見せるだけならこれで足りる。端末ごとの値でよい。 */

function readStatuses() {
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** 自分のアプリの現在の状態を1行で書き残す。他のアプリの切り替えシートに出る。 */
export function publishAppStatus(id, text) {
  try {
    const all = readStatuses();
    all[id] = { text: String(text || "").slice(0, 40), at: Date.now() };
    localStorage.setItem(STATUS_KEY, JSON.stringify(all));
  } catch {
    /* 状態表示は無くても困らないので、保存できなくても黙って続ける。 */
  }
}

function statusTextFor(id) {
  const entry = readStatuses()[id];
  if (!entry || !entry.text) return "";
  if (typeof entry.at === "number" && Date.now() - entry.at > STATUS_MAX_AGE_MS) return "";
  return entry.text;
}

/* ---------- 描画 ---------- */

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>'"]/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]
  ));
}

function rowMarkup(app, currentId) {
  const isCurrent = app.id === currentId;
  const state = isCurrent ? "" : statusTextFor(app.id);
  const tag = isCurrent ? "div" : "a";
  const attrs = isCurrent
    ? ' class="appsw-row" aria-current="page"'
    : ' class="appsw-row" href="' + app.href + '"';
  return (
    "<" + tag + attrs + ">" +
    appIconMarkup(app.id, 36) +
    '<span class="appsw-name">' + escapeHtml(app.name) +
    (isCurrent ? '<span class="appsw-here">今ここ</span>' : "") +
    "</span>" +
    (state ? '<span class="appsw-state">' + escapeHtml(state) + "</span>" : "") +
    "</" + tag + ">"
  );
}

function openSheet(currentId) {
  const existing = document.querySelector(".appsw-backdrop");
  if (existing) return;

  const backdrop = document.createElement("div");
  backdrop.className = "appsw appsw-backdrop";
  backdrop.innerHTML =
    '<div class="appsw-sheet" role="dialog" aria-modal="true" aria-label="アプリを切り替え">' +
    '<div class="appsw-head"><h2>アプリを切り替え</h2>' +
    '<button type="button" class="appsw-close">閉じる</button></div>' +
    '<div class="appsw-list">' + APPS.map((app) => rowMarkup(app, currentId)).join("") + "</div>" +
    "</div>";

  const previouslyFocused = document.activeElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKeyDown);
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
  };
  const onKeyDown = (event) => { if (event.key === "Escape") close(); };

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest(".appsw-close")) close();
  });
  document.addEventListener("keydown", onKeyDown);

  document.body.appendChild(backdrop);
  const first = backdrop.querySelector(".appsw-close");
  if (first) first.focus();
}

/**
 * 切り替えバーを画面の一番上に差し込む。
 * mount を渡さない場合は body の先頭に入れる（各アプリの既存レイアウトを触らずに済む）。
 */
export function mountAppSwitcher(options) {
  const currentId = (options && options.current) || "nakami";
  const app = APPS.find((entry) => entry.id === currentId) || APPS[1];
  const mount = (options && options.mount) || null;

  const bar = document.createElement("div");
  bar.className = "appsw appsw-bar";
  bar.innerHTML =
    '<button type="button" class="appsw-trigger" aria-haspopup="dialog">' +
    appIconMarkup(app.id, 26) +
    "<span>" + escapeHtml(app.name) + "</span>" +
    '<svg class="appsw-caret" viewBox="0 0 10 10" fill="none" aria-hidden="true">' +
    '<path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    "</button>";

  bar.querySelector(".appsw-trigger").addEventListener("click", () => openSheet(currentId));

  if (mount) mount.appendChild(bar);
  else document.body.insertBefore(bar, document.body.firstChild);

  /* 各アプリはこのフックだけを見る。切り替えバーを外しても
     アプリ側は `window.__appStatus?.(...)` が空振りするだけで壊れない。 */
  window.__appStatus = (text) => publishAppStatus(currentId, text);

  return bar;
}
