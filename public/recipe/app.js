/* つくりおきノート
   レシピと献立をこの端末のブラウザ内（localStorage）に保存する、モバイル優先の個人用アプリ。
   サーバー通信・アカウント・課金・外部サイト解析は一切行わない。 */

import { watchAuth, consumeRedirectResult, signIn, signOutUser, configured } from "./firebase.js";
import {
  setUser, newId, subscribe, saveDocument, patchDocument, removeDocument,
  saveMany, removeMany, removeCollection, uploadRecipeImage, deleteRecipeImage, onWriteError
} from "./store.js";

const PREFS_KEY = "tsukurioki-note-prefs-v1";
const LEGACY_KEY = "tsukurioki-note-state-v1";
/* selectCategory（献立作成時の一時的な絞り込み）は端末に残さない。次に開いたら「すべて」に戻る。 */
const PREF_FIELDS = ["tab", "sort", "scope", "keywordMode", "category", "theme"];

const CATEGORIES = ["主菜", "副菜", "汁物", "ごはん", "麺", "お菓子", "その他"];
const SOURCES = ["自分のレシピ", "SNS", "レシピサービス", "本・雑誌"];
const SLOTS = ["朝食", "昼食", "夕食", "その他"];
const SORTS = [
  ["new", "登録が新しい順"],
  ["old", "登録が古い順"],
  ["cooked-old", "しばらく作っていない順"],
  ["cooked-new", "最近作った順"],
  ["name-asc", "レシピ名順（あ→ん）"],
  ["name-desc", "レシピ名順（ん→あ）"]
];
const SCOPES = [
  ["name", "レシピ名のみ"],
  ["name-ing", "レシピ名と材料"],
  ["all", "メモ・手順も含める"]
];
const THEMES = [
  ["gold", "オレンジ", "#e7a400", "#c88500", "#fff4cf"],
  ["green", "グリーン", "#6fa16a", "#477a48", "#eef5ea"],
  ["blue", "ブルー", "#6f9ccd", "#4774a8", "#eaf1f9"]
];

const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3.2v2.1m0 13.4v2.1M3.2 12h2.1m13.4 0h2.1M5.8 5.8l1.5 1.5m9.4 9.4 1.5 1.5m0-12.4-1.5 1.5m-9.4 9.4-1.5 1.5"/><circle cx="12" cy="12" r="3.4"/></svg>',
  sort: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h11M4 12h8M4 17h5"/><path d="m17 7 3 3 3-3M20 10V4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5Z"/><path d="M5 19.5A1.5 1.5 0 0 1 6.5 18H19v3H6.5A1.5 1.5 0 0 1 5 19.5Z"/><path d="M9 7.5h6M9 11h4"/></svg>',
  meal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3v8M4 3v6a2 2 0 0 0 4 0V3M6 11v10M17 3v18M14 3v6c0 2 1.3 3 3 3"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 4h2l2.1 11.1a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 1.9-1.5L21 8H6"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m4 20 1.3-5.4L16.8 3.1a2 2 0 0 1 2.8 2.8L8.1 17.2 4 20Z"/><path d="m14.8 5.1 4.1 4.1"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></svg>',
  plate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3.5 12h17"/><path d="M4.6 12a7.4 7.4 0 0 0 14.8 0"/><path d="M9.6 4.2c0 1.3 1 1.6 1 2.9M13.4 3.2c0 1.5 1 1.8 1 3.2"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.3"/><path d="m5 17 4.5-4.5 3 3 2-2L19 17"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3s5 4.2 5 8.6A5 5 0 0 1 7 12c0-1.6.7-2.8 1.6-3.8C9.5 9.6 11 9.4 11 8c0-1.7 1-3.6 1-5Z"/><path d="M5 19h14"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9.5 14.5 5-5"/><path d="M11 7.5 12.6 6a3.7 3.7 0 0 1 5.3 5.2l-1.6 1.6M13 16.5 11.4 18a3.7 3.7 0 0 1-5.3-5.2l1.6-1.6"/></svg>'
};

const defaultState = {
  tab: "recipes",
  screen: "home",
  query: "",
  sort: "new",
  scope: "name-ing",
  keywordMode: "AND",
  category: "すべて",
  selectCategory: "すべて",
  theme: "gold",
  returnTo: "home",
  recipes: [],
  plans: [],
  shopping: []
};

let state = loadState();
let draftImage = "";
let draftImageBlob = null;
let draftImageDirty = false;
let pendingConfirm = null;
let searchTimer = 0;

/* phase: loading（認証待ち）/ syncing（初回同期待ち）/ signin / ready / setup */
let phase = "loading";
let authUser = null;
let unsubscribers = [];
let legacyData = null;
let netStatus = { offline: !navigator.onLine, pending: false };

/* 表示の好みだけを端末に残す。レシピ・献立・買い物リストは Firestore から流れてくる。 */
function loadState() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); } catch (error) { saved = {}; }
  const next = { ...defaultState, ...saved, recipes: [], plans: [], shopping: [] };
  if (!SORTS.some(([value]) => value === next.sort)) next.sort = "new";
  if (!SCOPES.some(([value]) => value === next.scope)) next.scope = "name-ing";
  if (next.keywordMode !== "OR") next.keywordMode = "AND";
  if (!THEMES.some(([value]) => value === next.theme)) next.theme = "gold";
  next.screen = "home";
  next.tab = ["recipes", "meal", "shopping", "search", "settings"].includes(next.tab) ? next.tab : "recipes";
  next.query = "";
  next.draft = null;
  next.editingId = null;
  next.editingPlanId = null;
  next.detailId = null;
  return next;
}

/* アカウントを使う前の版が localStorage に残していたデータ。初回ログイン時に引き継ぎを提案する。 */
function readLegacyData() {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
    if (!raw) return null;
    const recipes = (Array.isArray(raw.recipes) ? raw.recipes : []).map(normalizeRecipe);
    const plans = (Array.isArray(raw.plans) ? raw.plans : []).map(normalizePlan);
    const shopping = (Array.isArray(raw.shopping) ? raw.shopping : []).filter((item) => item && item.name);
    if (!recipes.length && !plans.length && !shopping.length) { localStorage.removeItem(LEGACY_KEY); return null; }
    return { recipes, plans, shopping };
  } catch (error) {
    return null;
  }
}

function normalizeRecipe(recipe) {
  const source = SOURCES.includes(recipe.source) ? recipe.source : "自分のレシピ";
  return {
    id: recipe.id || uid("recipe"),
    title: String(recipe.title || "無題のレシピ"),
    memo: String(recipe.memo || ""),
    category: CATEGORIES.includes(recipe.category) ? recipe.category : "その他",
    servings: Number(recipe.servings) > 0 ? Number(recipe.servings) : 2,
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients.filter(Boolean) : [],
    steps: Array.isArray(recipe.steps) ? recipe.steps.filter(Boolean) : [],
    source,
    refUrl: String(recipe.refUrl || ""),
    image: String(recipe.image || ""),
    createdAt: Number(recipe.createdAt) || Date.now(),
    lastCookedAt: Number(recipe.lastCookedAt) || 0
  };
}

function normalizePlan(plan) {
  return {
    id: plan.id || uid("plan"),
    date: /^\d{4}-\d{2}-\d{2}$/.test(plan.date || "") ? plan.date : todayISO(),
    slot: SLOTS.includes(plan.slot) ? plan.slot : "夕食",
    items: Array.isArray(plan.items) ? plan.items.filter((item) => item && item.id) : [],
    extras: Array.isArray(plan.extras) ? plan.extras.filter(Boolean) : [],
    memo: String(plan.memo || "")
  };
}

function normalizeShoppingItem(item) {
  return {
    id: item.id || uid("shop"),
    name: String(item.name || ""),
    recipeTitle: String(item.recipeTitle || ""),
    done: Boolean(item.done),
    createdAt: Number(item.createdAt) || Date.now()
  };
}

function saveState() {
  const prefs = {};
  PREF_FIELDS.forEach((key) => { prefs[key] = state[key]; });
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (error) { /* 表示設定なので失敗しても続ける */ }
}

function uid(prefix) { return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function esc(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function todayISO() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

function formatDate(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  if (!year) return "";
  const date = new Date(year, month - 1, day);
  return month + "/" + day + "（" + "日月火水木金土"[date.getDay()] + "）";
}

function daysAgoLabel(timestamp) {
  if (!timestamp) return "まだ作っていない";
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days <= 0) return "今日作った";
  if (days === 1) return "昨日作った";
  if (days < 30) return days + "日前に作った";
  return Math.floor(days / 30) + "か月前に作った";
}

function applyTheme() {
  const theme = THEMES.find(([value]) => value === state.theme) || THEMES[0];
  const root = document.documentElement;
  root.style.setProperty("--accent", theme[2]);
  root.style.setProperty("--accent-deep", theme[3]);
  root.style.setProperty("--accent-soft", theme[4]);
}

/* ---------- 画面の骨格 ---------- */

const OVERLAY_SCREENS = ["editor", "mealCreate", "recipeSelect"];

function navItem(tab, label, icon) {
  const active = state.tab === tab && !OVERLAY_SCREENS.includes(state.screen);
  return '<button class="bottom-nav__item ' + (active ? "is-active" : "") + '" data-tab="' + tab + '">' + ICONS[icon] + "<span>" + label + "</span></button>";
}

function renderNav() {
  const nav = document.querySelector("#bottom-nav");
  const hidden = OVERLAY_SCREENS.includes(state.screen);
  nav.hidden = hidden;
  nav.innerHTML = hidden ? "" : [
    navItem("recipes", "レシピ", "book"),
    navItem("meal", "献立", "meal"),
    navItem("shopping", "買い物", "cart"),
    navItem("search", "検索", "search"),
    navItem("settings", "設定", "settings")
  ].join("");
}

function renderTopbar() {
  const topbar = document.querySelector("#topbar");
  if (state.screen === "editor") {
    topbar.innerHTML = overlayBar(state.editingId ? "レシピを編集" : "レシピを登録", '<button class="topbar__link" data-action="save-recipe">保存</button>');
    return;
  }
  if (state.screen === "mealCreate") {
    topbar.innerHTML = overlayBar(state.editingPlanId ? "献立を編集" : "献立をつくる", '<button class="topbar__link" data-action="save-plan">保存</button>');
    return;
  }
  if (state.screen === "recipeSelect") {
    const count = (state.draft && state.draft.items ? state.draft.items.length : 0);
    topbar.innerHTML = overlayBar("レシピを選ぶ", '<button class="topbar__link" data-action="finish-selection">完了（' + count + "）</button>");
    return;
  }
  if (state.screen === "detail") {
    topbar.innerHTML = '<div class="topbar__row"><button class="icon-btn" data-action="back" aria-label="戻る">' + ICONS.close + '</button><h1 class="topbar__title">レシピ</h1><button class="topbar__link" data-action="edit-recipe" data-id="' + esc(state.detailId || "") + '">編集</button></div>';
    return;
  }
  if (state.screen === "search") {
    topbar.innerHTML = '<div class="topbar__row"><label class="search-box">' + ICONS.search + '<input id="search-input" type="search" value="' + esc(state.query) + '" placeholder="レシピ名・材料で検索" autocomplete="off" /></label><button class="icon-btn" data-action="search-settings" aria-label="検索設定">' + ICONS.settings + "</button></div>";
    return;
  }
  const titles = { recipes: "レシピ", meal: "献立", shopping: "買い物リスト", settings: "設定" };
  let trailing = "";
  if (state.tab === "recipes" && state.recipes.length) {
    trailing = '<button class="icon-btn" data-action="open-sort" aria-label="並べ替え">' + ICONS.sort + "</button>";
  }
  if (state.tab === "shopping" && state.shopping.length) {
    trailing = '<button class="icon-btn" data-action="ask-clear-shopping" aria-label="買い物リストを空にする">' + ICONS.trash + "</button>";
  }
  topbar.innerHTML = '<div class="topbar__row"><h1 class="topbar__title">' + (titles[state.tab] || "つくりおきノート") + "</h1>" + (trailing ? '<div class="topbar__actions">' + trailing + "</div>" : "") + "</div>";
}

function overlayBar(title, action) {
  return '<div class="topbar__row"><button class="icon-btn" data-action="back" aria-label="閉じる">' + ICONS.close + '</button><h1 class="topbar__title topbar__title--sm">' + esc(title) + "</h1>" + action + "</div>";
}

function render() {
  applyTheme();
  if (phase !== "ready") { renderGate(); return; }
  document.querySelector("#topbar").hidden = false;
  renderTopbar();
  renderNav();
  const views = {
    home: renderHome,
    search: renderSearch,
    editor: renderEditor,
    detail: renderDetail,
    meal: renderMeal,
    mealCreate: renderMealCreate,
    recipeSelect: renderRecipeSelect,
    shopping: renderShopping,
    settings: renderSettings
  };
  document.querySelector("#main-content").innerHTML = (views[state.screen] || renderHome)();
  document.body.classList.toggle("has-action-bar", ["mealCreate", "recipeSelect"].includes(state.screen));
  renderNetBanner();
  publishSwitcherStatus();
}

/* アプリ切り替えシートに出す「今の状態」を1行で書き残す。
   window.__appStatus は共有の切り替えバーが用意する。単独で動かすときは何も起きない。
   買い物リストを最優先にしているのは、それが一番「開く理由」になるため。 */
function publishSwitcherStatus() {
  if (typeof window.__appStatus !== "function") return;
  try {
    const todo = state.shopping.filter((item) => !item.done).length;
    if (todo) { window.__appStatus("買い物 未購入" + todo + "件"); return; }
    if (state.plans.length) { window.__appStatus("献立 " + state.plans.length + "件"); return; }
    window.__appStatus(state.recipes.length ? "レシピ " + state.recipes.length + "件" : "レシピはまだありません");
  } catch {
    /* 状態表示は無くても困らない */
  }
}

/* ログイン前・同期前・未設定のときの画面 */
function renderGate() {
  document.querySelector("#topbar").hidden = true;
  document.querySelector("#bottom-nav").hidden = true;
  document.body.classList.remove("has-action-bar");
  const views = { loading: loadingView, syncing: loadingView, signin: signInView, setup: setupView };
  document.querySelector("#main-content").innerHTML = (views[phase] || loadingView)();
  renderNetBanner();
}

function loadingView() {
  return '<section class="gate"><div class="spinner" aria-hidden="true"></div><p class="note">' + (phase === "syncing" ? "データを読み込んでいます…" : "読み込んでいます…") + "</p></section>";
}

function signInView() {
  return '<section class="gate">' +
    '<div class="gate__mark">' + ICONS.book + "</div>" +
    "<h1>つくりおきノート</h1>" +
    "<p>レシピと献立をアカウントに保存します。スマホでもパソコンでも同じ内容が見られます。</p>" +
    '<button class="btn btn--primary btn--wide" data-action="sign-in">Googleでログイン</button>' +
    '<p class="gate__note">保存したデータを読み書きできるのは、ログインしたあなたのアカウントだけです。</p></section>';
}

function setupView() {
  return '<section class="gate">' +
    "<h1>Firebaseの設定が必要です</h1>" +
    "<p><code>firebase-config.js</code> にプロジェクトの設定値がまだ入っていません。" +
    "Firebaseコンソールの「プロジェクトの設定」→「マイアプリ」に表示される firebaseConfig を貼り付けてください。</p>" +
    '<p class="gate__note">手順は同じフォルダの SETUP.md にまとめてあります。</p></section>';
}

function renderNetBanner() {
  const banner = document.querySelector("#net-banner");
  if (!banner) return;
  if (netStatus.offline) {
    banner.innerHTML = '<div class="net-banner">オフライン — 変更はこの端末に残り、接続すると同期されます</div>';
    return;
  }
  banner.innerHTML = netStatus.pending ? '<div class="net-banner net-banner--sync">同期中…</div>' : "";
}

function go(screen, tab) {
  state.screen = screen;
  if (tab) state.tab = tab;
  saveState();
  render();
  window.scrollTo({ top: 0 });
}

/* ---------- レシピの抽出と並べ替え ---------- */

function haystack(recipe, scope) {
  if (scope === "name") return recipe.title;
  if (scope === "name-ing") return [recipe.title, ...recipe.ingredients].join(" ");
  return [recipe.title, recipe.memo, recipe.category, recipe.source, ...recipe.ingredients, ...recipe.steps].join(" ");
}

function sortRecipes(list) {
  const sorted = list.slice();
  if (state.sort === "new") sorted.sort((a, b) => b.createdAt - a.createdAt);
  if (state.sort === "old") sorted.sort((a, b) => a.createdAt - b.createdAt);
  if (state.sort === "cooked-new") sorted.sort((a, b) => b.lastCookedAt - a.lastCookedAt);
  if (state.sort === "cooked-old") sorted.sort((a, b) => a.lastCookedAt - b.lastCookedAt);
  if (state.sort === "name-asc") sorted.sort((a, b) => a.title.localeCompare(b.title, "ja"));
  if (state.sort === "name-desc") sorted.sort((a, b) => b.title.localeCompare(a.title, "ja"));
  return sorted;
}

function usedCategories() {
  return CATEGORIES.filter((category) => state.recipes.some((recipe) => recipe.category === category));
}

function categoryChips(current, action) {
  const list = ["すべて", ...usedCategories()];
  if (list.length < 3) return "";
  return '<div class="chip-row">' + list.map((category) => '<button class="chip ' + (current === category ? "is-active" : "") + '" data-action="' + action + '" data-value="' + esc(category) + '">' + esc(category) + "</button>").join("") + "</div>";
}

function browseRecipes() {
  const list = state.category === "すべて" ? state.recipes : state.recipes.filter((recipe) => recipe.category === state.category);
  return sortRecipes(list);
}

function searchRecipes() {
  const tokens = state.query.trim().toLowerCase().split(/[\s　]+/).filter(Boolean);
  if (!tokens.length) return [];
  const matched = state.recipes.filter((recipe) => {
    const hay = haystack(recipe, state.scope).toLowerCase();
    return state.keywordMode === "AND" ? tokens.every((token) => hay.includes(token)) : tokens.some((token) => hay.includes(token));
  });
  return sortRecipes(matched);
}

/* ---------- 一覧（リスト形式） ---------- */

function thumb(recipe) {
  const fallback = '<span class="thumb thumb--empty">' + ICONS.plate;
  if (!recipe.image) return fallback + "</span>";
  return fallback + '<img src="' + esc(recipe.image) + '" alt="" loading="lazy" onerror="this.remove()" /></span>';
}

/* 1列リストの行テンプレート。レシピ一覧・レシピ選択・買い物リストはすべてここを通る。
   一覧の見た目を変えるときはこの関数だけを直せばよい。
   title / meta / sub は組み立て済みのHTML（呼び出し側で esc すること）。
   modifier は class="row " の直後にそのまま入る（状態クラスもここに載せる）。 */
function row(config) {
  const tag = config.tag || "button";
  const meta = config.meta || "";
  const sub = config.sub || "";
  return "<" + tag + ' class="row ' + config.modifier + '"' + (config.attrs || "") + ">" +
    (config.lead || "") +
    '<span class="row__main"><span class="row__title">' + (config.title || "") + "</span>" +
    (meta ? '<span class="row__meta">' + meta + "</span>" : "") +
    (sub ? '<span class="row__sub">' + sub + "</span>" : "") +
    "</span>" +
    (config.trailing || "") +
    "</" + tag + ">";
}

function recipeRow(recipe) {
  const meta = [recipe.category, "材料" + recipe.ingredients.length, recipe.servings + "人分"].join(" ／ ");
  return row({
    modifier: "row--recipe",
    attrs: ' data-action="detail" data-id="' + esc(recipe.id) + '"',
    lead: thumb(recipe),
    title: esc(recipe.title),
    meta: esc(meta),
    sub: esc(daysAgoLabel(recipe.lastCookedAt)),
    trailing: '<span class="row__go">' + ICONS.chevron + "</span>"
  });
}

/* 献立づくりのレシピ選択画面の行。 */
function pickRow(recipe, picked) {
  return row({
    modifier: "row--pick " + (picked ? "is-picked" : ""),
    attrs: ' data-action="toggle-pick" data-id="' + esc(recipe.id) + '"',
    lead: thumb(recipe),
    title: esc(recipe.title),
    meta: esc(recipe.category) + " ／ 材料" + recipe.ingredients.length,
    trailing: '<span class="row__check">' + (picked ? ICONS.check : "") + "</span>"
  });
}

/* 買い物リストの行。チェックボックスを含むので label で組む。 */
function shoppingRow(item) {
  return row({
    tag: "label",
    modifier: "row--check",
    lead: '<input type="checkbox" data-action="toggle-shopping" data-id="' + esc(item.id) + '" ' + (item.done ? "checked" : "") + ' />',
    title: esc(item.name),
    meta: item.recipeTitle ? esc(item.recipeTitle) : "",
    trailing: '<button type="button" class="line__remove" data-action="remove-shopping" data-id="' + esc(item.id) + '" aria-label="削除">' + ICONS.close + "</button>"
  });
}

function recipeList(list) {
  return '<div class="row-list">' + list.map(recipeRow).join("") + "</div>";
}

function emptyBox(title, body, actionHtml) {
  return '<div class="empty"><h2>' + title + "</h2><p>" + body + "</p>" + (actionHtml || "") + "</div>";
}

function renderHome() {
  if (!state.recipes.length) {
    return '<section>' + emptyBox("レシピがまだありません", "右下の＋から、材料と手順を入力して登録します。<br>保存先はこの端末のブラウザ内です。", '<button class="btn btn--primary" data-action="new-recipe">最初のレシピを登録する</button>') + fab("new-recipe", "レシピを登録") + "</section>";
  }
  const list = browseRecipes();
  const sortLabel = (SORTS.find(([value]) => value === state.sort) || SORTS[0])[1];
  return "<section>" + categoryChips(state.category, "set-category") +
    '<div class="list-head"><span>' + list.length + '件</span><button class="link-btn" data-action="open-sort">' + esc(sortLabel) + "</button></div>" +
    (list.length ? recipeList(list) : emptyBox("この分類のレシピはありません", "上の分類を切り替えてください。", "")) +
    fab("new-recipe", "レシピを登録") + "</section>";
}

function fab(action, label) {
  return '<button class="fab" data-action="' + action + '" aria-label="' + label + '">' + ICONS.plus + "</button>";
}

function renderSearch() {
  const scopeLabel = (SCOPES.find(([value]) => value === state.scope) || SCOPES[1])[1];
  const conditions = '<div class="search-cond"><button class="link-btn" data-action="search-settings">' + esc(scopeLabel) + " ／ " + (state.keywordMode === "AND" ? "すべての語を含む" : "いずれかの語を含む") + "</button></div>";
  return "<section>" + conditions + '<div id="search-results">' + searchResultsHtml() + "</div></section>";
}

function searchResultsHtml() {
  if (!state.recipes.length) return emptyBox("レシピがまだありません", "先にレシピを登録すると検索できます。", "");
  if (!state.query.trim()) return emptyBox("キーワードで探す", "レシピ名や材料を入力してください。<br>スペース区切りで複数の語を指定できます。", "");
  const list = searchRecipes();
  if (!list.length) return emptyBox("見つかりません", "語を減らすか、検索条件を「いずれかの語を含む」に変えてみてください。", "");
  return '<div class="list-head"><span>' + list.length + "件</span></div>" + recipeList(list);
}

/* ---------- レシピの登録・編集 ---------- */

function lineRow(type, value) {
  const placeholder = type === "ingredient" ? "例）鶏もも肉 300g" : "手順を入力";
  return '<div class="line"><input name="' + type + '" value="' + esc(value || "") + '" placeholder="' + placeholder + '" /><button type="button" class="line__remove" data-action="remove-line" aria-label="この行を削除">' + ICONS.close + "</button></div>";
}

function renderEditor() {
  const recipe = state.editingId ? state.recipes.find((item) => item.id === state.editingId) : null;
  const ingredients = recipe && recipe.ingredients.length ? recipe.ingredients : ["", ""];
  const steps = recipe && recipe.steps.length ? recipe.steps : ["", ""];
  const image = draftImage;
  return '<form class="stack" id="recipe-form">' +
    '<div class="card">' +
      '<div class="cover">' +
        '<label class="cover__drop" for="cover-input" ' + (image ? 'hidden' : "") + ">" + ICONS.image + "<span>写真</span></label>" +
        '<div class="cover__preview" ' + (image ? "" : "hidden") + '><img id="cover-preview" src="' + esc(image) + '" alt="" /><button type="button" class="cover__clear" data-action="clear-cover">写真を削除</button></div>' +
        '<input id="cover-input" type="file" accept="image/*" hidden />' +
      "</div>" +
      '<div class="field"><label for="recipe-title">レシピ名</label><input id="recipe-title" name="title" required placeholder="例）照り焼きチキン" value="' + esc(recipe ? recipe.title : "") + '" /></div>' +
      '<div class="field-pair">' +
        '<div class="field"><label for="recipe-category">分類</label><select id="recipe-category" name="category">' + CATEGORIES.map((category) => '<option ' + (recipe && recipe.category === category ? "selected" : "") + ">" + category + "</option>").join("") + "</select></div>" +
        '<div class="field"><label for="recipe-servings">何人分</label><input id="recipe-servings" name="servings" type="number" min="1" max="20" value="' + (recipe ? recipe.servings : 2) + '" /></div>' +
      "</div>" +
      '<div class="field-pair">' +
        '<div class="field"><label for="recipe-source">どこで見つけた</label><select id="recipe-source" name="source">' + SOURCES.map((source) => '<option ' + (recipe && recipe.source === source ? "selected" : "") + ">" + source + "</option>").join("") + "</select></div>" +
        '<div class="field"><label for="recipe-url">参考URL（任意）</label><input id="recipe-url" name="refUrl" type="url" placeholder="https://" value="' + esc(recipe ? recipe.refUrl : "") + '" /></div>' +
      "</div>" +
      '<div class="field"><label for="recipe-memo">メモ（任意）</label><textarea id="recipe-memo" name="memo" placeholder="味の調整や、次に作るときの気づきなど">' + esc(recipe ? recipe.memo : "") + "</textarea></div>" +
    "</div>" +
    '<div class="card"><h2 class="card__head">材料</h2><div class="lines" id="ingredients-list">' + ingredients.map((value) => lineRow("ingredient", value)).join("") + '</div><button type="button" class="link-btn link-btn--add" data-action="add-ingredient">＋ 材料を追加</button></div>' +
    '<div class="card"><h2 class="card__head">手順</h2><div class="lines" id="steps-list">' + steps.map((value) => lineRow("step", value)).join("") + '</div><button type="button" class="link-btn link-btn--add" data-action="add-step">＋ 手順を追加</button></div>' +
    '<div class="stack__actions"><button type="submit" class="btn btn--primary btn--wide">' + (recipe ? "変更を保存" : "レシピを登録") + "</button>" +
      (recipe ? '<button type="button" class="btn btn--danger btn--wide" data-action="ask-delete-recipe" data-id="' + esc(recipe.id) + '">このレシピを削除</button>' : "") +
    "</div></form>";
}

/* ---------- レシピ詳細 ---------- */

function renderDetail() {
  const recipe = state.recipes.find((item) => item.id === state.detailId);
  if (!recipe) return "<section>" + emptyBox("レシピが見つかりません", "削除された可能性があります。", '<button class="btn" data-action="back">戻る</button>') + "</section>";
  const hero = '<div class="detail__hero detail__hero--empty">' + ICONS.plate +
    (recipe.image ? '<img src="' + esc(recipe.image) + '" alt="" onerror="this.remove()" />' : "") + "</div>";
  const url = recipe.refUrl ? '<a class="detail__url" href="' + esc(recipe.refUrl) + '" target="_blank" rel="noopener">' + ICONS.link + "参考にしたページ</a>" : "";
  return "<section>" + hero +
    '<div class="detail__head"><h1>' + esc(recipe.title) + '</h1><p class="detail__meta">' + esc(recipe.category) + " ／ " + esc(recipe.source) + " ／ " + recipe.servings + "人分</p>" +
    '<p class="detail__cooked">' + esc(daysAgoLabel(recipe.lastCookedAt)) + "</p>" + url + "</div>" +
    (recipe.memo ? '<div class="card"><h2 class="card__head">メモ</h2><p class="detail__memo">' + esc(recipe.memo) + "</p></div>" : "") +
    '<div class="card"><h2 class="card__head">材料<span class="card__note">' + recipe.servings + "人分</span></h2><ul class=\"plain-list\">" + recipe.ingredients.map((item) => "<li>" + esc(item) + "</li>").join("") + "</ul></div>" +
    '<div class="card"><h2 class="card__head">手順</h2><ol class="step-list">' + recipe.steps.map((item) => "<li>" + esc(item) + "</li>").join("") + "</ol></div>" +
    '<div class="detail__actions">' +
      '<button class="btn btn--primary btn--wide" data-action="mark-cooked" data-id="' + esc(recipe.id) + '">' + ICONS.flame + "作った</button>" +
      '<button class="btn btn--wide" data-action="quick-plan" data-id="' + esc(recipe.id) + '">献立に追加</button>' +
      '<button class="btn btn--wide" data-action="add-to-shopping" data-id="' + esc(recipe.id) + '">材料を買い物リストへ</button>' +
    "</div></section>";
}

/* ---------- 献立 ---------- */

/* 献立の items には登録した時点のレシピ名が焼き付いている。
   レシピを改名しても献立に旧名が残らないよう、表示のときに現在の名前を引き直す。
   （レシピ側が見つからないとき＝削除済みなどのときだけ、焼き付いた名前を使う） */
function planItemTitle(item) {
  const recipe = state.recipes.find((entry) => entry.id === item.id);
  return recipe ? recipe.title : item.title;
}

function planCard(plan) {
  const names = plan.items.map(planItemTitle).concat(plan.extras);
  return '<article class="card plan"><div class="plan__head"><div><span class="plan__date">' + esc(formatDate(plan.date)) + '</span><span class="plan__slot">' + esc(plan.slot) + "</span></div>" +
    '<div class="plan__tools"><button class="icon-btn icon-btn--sm" data-action="edit-plan" data-id="' + esc(plan.id) + '" aria-label="編集">' + ICONS.pencil + '</button><button class="icon-btn icon-btn--sm" data-action="ask-delete-plan" data-id="' + esc(plan.id) + '" aria-label="削除">' + ICONS.trash + "</button></div></div>" +
    '<ul class="plain-list plan__items">' + names.map((name) => "<li>" + esc(name) + "</li>").join("") + "</ul>" +
    (plan.memo ? '<p class="plan__memo">' + esc(plan.memo) + "</p>" : "") + "</article>";
}

function renderMeal() {
  if (!state.plans.length) {
    return "<section>" + emptyBox("献立はまだありません", "その日に作るものをまとめておくと、買い物リストも作りやすくなります。", '<button class="btn btn--primary" data-action="new-plan">献立をつくる</button>') + "</section>";
  }
  const sorted = state.plans.slice().sort((a, b) => b.date.localeCompare(a.date));
  return '<section><div class="list-head"><span>' + sorted.length + '件</span><button class="link-btn" data-action="new-plan">＋ 献立をつくる</button></div><div class="stack">' + sorted.map(planCard).join("") + "</div></section>";
}

function renderMealCreate() {
  const draft = state.draft;
  const chosen = draft.items.map((id) => state.recipes.find((recipe) => recipe.id === id)).filter(Boolean);
  return "<section>" +
    '<div class="card"><h2 class="card__head">日付と時間帯</h2>' +
      '<div class="field"><label for="plan-date">日付</label><input id="plan-date" type="date" value="' + esc(draft.date) + '" /></div>' +
      '<div class="field"><label>時間帯</label><div class="seg">' + SLOTS.map((slot) => '<button type="button" class="' + (draft.slot === slot ? "is-active" : "") + '" data-action="set-slot" data-value="' + slot + '">' + slot + "</button>").join("") + "</div></div></div>" +
    '<div class="card"><h2 class="card__head">レシピ<span class="card__note">' + chosen.length + "品</span></h2>" +
      (chosen.length ? '<ul class="chosen">' + chosen.map((recipe) => "<li>" + esc(recipe.title) + '<button type="button" class="line__remove" data-action="unpick" data-id="' + esc(recipe.id) + '" aria-label="外す">' + ICONS.close + "</button></li>").join("") + "</ul>" : '<p class="note">まだ選ばれていません。</p>') +
      '<button type="button" class="link-btn link-btn--add" data-action="pick-recipes">＋ 登録済みのレシピから選ぶ</button></div>' +
    '<div class="card"><h2 class="card__head">レシピ以外の一品</h2><p class="note">ごはん・味噌汁・サラダなど、レシピを登録していないものを書き足せます。</p>' +
      (draft.extras.length ? '<ul class="chosen">' + draft.extras.map((name, index) => "<li>" + esc(name) + '<button type="button" class="line__remove" data-action="remove-extra" data-index="' + index + '" aria-label="外す">' + ICONS.close + "</button></li>").join("") + "</ul>" : "") +
      '<div class="inline-add"><input id="plan-extra" placeholder="例）ごはん" /><button type="button" class="btn btn--sm" data-action="add-extra">追加</button></div></div>' +
    '<div class="card"><h2 class="card__head">調理メモ（任意）</h2><textarea id="plan-memo" placeholder="例）子ども用は辛さ控えめにする">' + esc(draft.memo) + "</textarea></div>" +
    '<div class="action-bar"><button class="btn" data-action="back">やめる</button><button class="btn btn--primary" data-action="save-plan">献立を保存</button></div></section>';
}

function renderRecipeSelect() {
  const draft = state.draft;
  if (!state.recipes.length) {
    return "<section>" + emptyBox("レシピがありません", "先にレシピを登録すると、献立に追加できます。", '<button class="btn btn--primary" data-action="new-recipe">レシピを登録する</button>') + "</section>";
  }
  const list = state.selectCategory === "すべて" ? state.recipes : state.recipes.filter((recipe) => recipe.category === state.selectCategory);
  const sorted = sortRecipes(list);
  return "<section>" + categoryChips(state.selectCategory, "set-select-category") +
    (sorted.length ? '<div class="row-list">' + sorted.map((recipe) => pickRow(recipe, draft.items.includes(recipe.id))).join("") + "</div>" : emptyBox("この分類のレシピはありません", "上の分類を切り替えてください。", "")) +
    '<div class="action-bar"><button class="btn" data-action="back">戻る</button><button class="btn btn--primary" data-action="finish-selection">完了（' + draft.items.length + "）</button></div></section>";
}

/* ---------- 買い物リスト ---------- */

function renderShopping() {
  if (!state.shopping.length) {
    return "<section>" + emptyBox("買い物リストは空です", "レシピの材料をまとめて入れるか、思いついたものを直接書き足せます。", '<button class="btn btn--primary" data-action="open-shopping-add">レシピの材料を入れる</button>') + shoppingInput() + "</section>";
  }
  const todo = state.shopping.filter((item) => !item.done);
  const done = state.shopping.filter((item) => item.done);
  return "<section>" +
    '<div class="list-head"><span>未購入 ' + todo.length + '件</span><button class="link-btn" data-action="open-shopping-add">＋ レシピから入れる</button></div>' +
    (todo.length ? '<div class="row-list">' + todo.map(shoppingRow).join("") + "</div>" : '<p class="note note--center">未購入のものはありません。</p>') +
    (done.length ? '<div class="list-head list-head--sub"><span>購入済み ' + done.length + '件</span><button class="link-btn" data-action="clear-done">まとめて消す</button></div><div class="row-list row-list--done">' + done.map(shoppingRow).join("") + "</div>" : "") +
    shoppingInput() + "</section>";
}

function shoppingInput() {
  return '<div class="inline-add inline-add--sticky"><input id="shopping-input" placeholder="直接書き足す（例）牛乳" /><button type="button" class="btn btn--sm" data-action="add-shopping-manual">追加</button></div>';
}

/* ---------- 設定 ---------- */

function renderSettings() {
  const swatches = THEMES.map(([value, label, color]) => '<button class="swatch ' + (state.theme === value ? "is-active" : "") + '" data-action="set-theme" data-value="' + value + '"><span style="background:' + color + '"></span>' + label + "</button>").join("");
  const photo = authUser && authUser.photoURL ? '<img class="account__photo" src="' + esc(authUser.photoURL) + '" alt="" referrerpolicy="no-referrer" />' : '<span class="account__photo account__photo--empty">' + ICONS.book + "</span>";
  const account = '<div class="card"><h2 class="card__head">アカウント</h2><div class="account">' + photo +
    "<div><strong>" + esc(authUser ? authUser.displayName || "ログイン中" : "") + '</strong><span class="note">' + esc(authUser ? authUser.email || "" : "") + "</span></div></div>" +
    '<div class="stack__actions"><button class="btn btn--wide" data-action="sign-out">ログアウト</button></div></div>';
  return "<section>" + account +
    '<div class="card"><h2 class="card__head">表示</h2><p class="note">アクセントカラー（この端末だけの設定）</p><div class="swatches">' + swatches + "</div></div>" +
    '<div class="card"><h2 class="card__head">保存されているもの</h2><ul class="plain-list"><li>レシピ ' + state.recipes.length + "件</li><li>献立 " + state.plans.length + "件</li><li>買い物リスト " + state.shopping.length + "件</li></ul></div>" +
    '<div class="card"><h2 class="card__head">データ</h2><p class="note">データはあなたのアカウントに保存され、ログインすればどの端末からでも同じ内容が見られます。電波がないところでも閲覧・編集でき、つながったときにまとめて同期されます。</p>' +
      '<div class="stack__actions"><button class="btn btn--wide" data-action="export-data">JSONに書き出す</button><label class="btn btn--wide" for="import-input">JSONから読み込む</label><input id="import-input" type="file" accept="application/json,.json" hidden />' +
      '<button class="btn btn--danger btn--wide" data-action="ask-reset">すべてのデータを削除</button></div></div>' +
    '<div class="card"><h2 class="card__head">このアプリについて</h2><p class="note">つくりおきノートは、献立とレシピを管理するための個人用アプリです。課金や広告はありません。保存した内容を読み書きできるのはログインしたあなたのアカウントだけで、他の人からは見えません。</p></div>' +
    "</section>";
}

/* ---------- シート（並べ替え・検索設定・材料の取り込み・確認） ---------- */

function sheet(title, body, closeLabel) {
  return '<div class="sheet-back" data-action="close-modal"><section class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="sheet__grip"></div><h2 class="sheet__title">' + esc(title) + "</h2>" + body + '<button class="sheet__close" data-action="close-modal">' + (closeLabel || "閉じる") + "</button></section></div>";
}

function openSheet(html) {
  document.querySelector("#modal-root").innerHTML = html;
}

function closeModal() {
  document.querySelector("#modal-root").innerHTML = "";
  pendingConfirm = null;
}

function openSort() {
  const body = '<div class="sheet-list">' + SORTS.map(([value, label]) => '<button class="' + (state.sort === value ? "is-selected" : "") + '" data-action="set-sort" data-value="' + value + '">' + label + "</button>").join("") + "</div>";
  openSheet(sheet("並べ替え", body));
}

function openSearchSettings() {
  const body = '<p class="sheet__label">検索する範囲</p><div class="sheet-list">' +
    SCOPES.map(([value, label]) => '<button class="' + (state.scope === value ? "is-selected" : "") + '" data-action="set-scope" data-value="' + value + '">' + label + "</button>").join("") + "</div>" +
    '<p class="sheet__label">複数の語を入れたとき</p><div class="seg">' +
    '<button class="' + (state.keywordMode === "AND" ? "is-active" : "") + '" data-action="set-keyword-mode" data-value="AND">すべて含む</button>' +
    '<button class="' + (state.keywordMode === "OR" ? "is-active" : "") + '" data-action="set-keyword-mode" data-value="OR">いずれか含む</button></div>';
  openSheet(sheet("検索の設定", body, "設定を閉じる"));
}

function openShoppingAdd() {
  const body = state.recipes.length
    ? '<div class="sheet-list">' + state.recipes.map((recipe) => '<button data-action="add-recipe-shopping" data-id="' + esc(recipe.id) + '">' + esc(recipe.title) + '<span class="sheet-list__note">材料' + recipe.ingredients.length + "</span></button>").join("") + "</div>"
    : '<p class="note note--center">先にレシピを登録してください。</p>';
  openSheet(sheet("材料を入れるレシピ", body));
}

function openConfirm(title, message, label, run) {
  pendingConfirm = run;
  const body = '<p class="note">' + message + '</p><div class="stack__actions"><button class="btn btn--danger btn--wide" data-action="confirm-yes">' + esc(label) + "</button></div>";
  openSheet(sheet(title, body, "やめる"));
}

function showToast(message, tone) {
  const region = document.querySelector("#toast-region");
  region.innerHTML = '<div class="toast ' + (tone ? "is-" + tone : "") + '">' + esc(message) + "</div>";
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { region.innerHTML = ""; }, 2600);
}

/* ---------- 入力の取り出し ---------- */

function readLines(id, name) {
  const scope = document.querySelector("#" + id);
  if (!scope) return [];
  return [...scope.querySelectorAll('input[name="' + name + '"]')].map((input) => input.value.trim()).filter(Boolean);
}

function addLine(type) {
  const list = document.querySelector("#" + (type === "ingredient" ? "ingredients" : "steps") + "-list");
  list.insertAdjacentHTML("beforeend", lineRow(type, ""));
  const inputs = list.querySelectorAll("input");
  inputs[inputs.length - 1].focus();
}

function captureMealForm() {
  if (!state.draft) return;
  const date = document.querySelector("#plan-date");
  const memo = document.querySelector("#plan-memo");
  if (date && date.value) state.draft.date = date.value;
  if (memo) state.draft.memo = memo.value;
}

function resetDraftImage() {
  if (draftImage && draftImage.startsWith("blob:")) URL.revokeObjectURL(draftImage);
  draftImage = "";
  draftImageBlob = null;
  draftImageDirty = false;
}

/* 保存直後の同期的な描き直し（saveRecipe → go("detail") など）のための楽観更新。
   Firestore のローカルキャッシュ経由の onSnapshot はすぐ来るが同期的ではないため、
   これを外すと新規保存直後の詳細画面が一瞬「見つかりません」になりうる。
   unshift の並びが画面に出ることはない（詳細・献立とも別の順序で描き直される）。 */
function applyLocal(name, item) {
  const list = state[name];
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item; else list.unshift(item);
}

async function saveRecipe() {
  const title = (document.querySelector("#recipe-title").value || "").trim();
  const ingredients = readLines("ingredients-list", "ingredient");
  const steps = readLines("steps-list", "step");
  if (!title) { showToast("レシピ名を入力してください"); return; }
  if (!ingredients.length) { showToast("材料を1つ以上入力してください"); return; }
  if (!steps.length) { showToast("手順を1つ以上入力してください"); return; }
  const fields = {
    title,
    ingredients,
    steps,
    memo: (document.querySelector("#recipe-memo").value || "").trim(),
    category: document.querySelector("#recipe-category").value,
    servings: Math.max(1, Number(document.querySelector("#recipe-servings").value) || 2),
    source: document.querySelector("#recipe-source").value,
    refUrl: (document.querySelector("#recipe-url").value || "").trim()
  };
  const existing = state.editingId ? state.recipes.find((item) => item.id === state.editingId) : null;
  const id = state.editingId || newId("recipes");
  let image = existing ? existing.image : "";

  if (draftImageDirty) {
    if (draftImageBlob) {
      if (!navigator.onLine) {
        showToast("オフラインのため写真は保存できません。他の内容だけ保存します", "danger");
      } else {
        showToast("写真をアップロードしています…");
        try {
          image = await uploadRecipeImage(id, draftImageBlob);
        } catch (error) {
          /* 画像APIはユーザーに見せてよい文言を返してくる。そのまま出す。 */
          const message = (error && error.message) || "写真をアップロードできませんでした";
          showToast(message + "。他の内容だけ保存します", "danger");
          image = existing ? existing.image : "";
        }
      }
    } else {
      image = "";
      deleteRecipeImage(id).catch(() => {});
    }
  }

  const recipe = normalizeRecipe({
    ...(existing || {}), ...fields, id, image,
    createdAt: existing ? existing.createdAt : Date.now(),
    lastCookedAt: existing ? existing.lastCookedAt : 0
  });
  const { id: documentId, ...payload } = recipe;
  saveDocument("recipes", documentId, payload);
  applyLocal("recipes", recipe);
  resetDraftImage();
  state.editingId = null;
  state.detailId = id;
  saveState();
  go("detail", "recipes");
  showToast(existing ? "変更を保存しました" : "レシピを登録しました", "success");
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const max = 1080;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale) || 1;
        canvas.height = Math.round(image.height * scale) || 1;
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("画像を変換できませんでした")); return; }
          resolve({ blob, url: URL.createObjectURL(blob) });
        }, "image/jpeg", 0.82);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function pushShopping(names, recipeTitle) {
  const existing = new Set(state.shopping.map((item) => item.name));
  const added = [];
  names.forEach((name) => {
    if (existing.has(name)) return;
    existing.add(name);
    added.push(normalizeShoppingItem({ id: newId("shopping"), name, recipeTitle: recipeTitle || "", done: false, createdAt: Date.now() + added.length }));
  });
  if (added.length) {
    state.shopping = [...state.shopping, ...added];
    saveMany("shopping", added);
  }
  return added.length;
}

function exportData() {
  const payload = JSON.stringify({ recipes: state.recipes, plans: state.plans, shopping: state.shopping }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "tsukurioki-note-" + todayISO() + ".json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("書き出しました", "success");
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let payload = null;
    try {
      const data = JSON.parse(String(reader.result));
      payload = {
        recipes: (data.recipes || []).map(normalizeRecipe),
        plans: (data.plans || []).map(normalizePlan),
        shopping: (data.shopping || []).filter((item) => item && item.name).map(normalizeShoppingItem)
      };
    } catch (error) {
      showToast("このファイルは読み込めませんでした", "danger");
      return;
    }
    /* 取り込みは追加ではなく置き換え。いま入っているデータが消えるので必ず確認を挟む。 */
    openConfirm("JSONから読み込む",
      "現在のレシピ・献立・買い物リストをすべて置き換えます。読み込む内容はレシピ" + payload.recipes.length + "件・献立" + payload.plans.length + "件・買い物" + payload.shopping.length + "件です。いま保存されている内容は消え、元に戻せません。",
      "置き換える", () => { replaceAllData(payload); });
  };
  reader.readAsText(file);
}

/* 取り込み前にコレクションを空にする。消さずに saveMany だけすると、
   ファイルに入っていない古いレシピが Firestore に残り、直後の購読で画面に戻ってくる。
   削除の完了を待ってから保存するため、待てないオフライン時は実行しない。 */
async function replaceAllData(payload) {
  if (!navigator.onLine) {
    showToast("オフラインのため読み込めません。接続してからもう一度お試しください", "danger");
    return;
  }
  showToast("読み込んでいます…");
  try {
    await removeCollection("recipes");
    await removeCollection("plans");
    await removeCollection("shopping");
  } catch (error) {
    showToast("読み込めませんでした（" + ((error && error.code) || "error") + "）", "danger");
    return;
  }
  state.recipes = payload.recipes;
  state.plans = payload.plans;
  state.shopping = payload.shopping;
  saveMany("recipes", payload.recipes);
  saveMany("plans", payload.plans);
  saveMany("shopping", payload.shopping);
  render();
  showToast("読み込みました。同期にはしばらくかかることがあります", "success");
}

/* ---------- 操作 ---------- */

function handleAction(element) {
  const action = element.dataset.action;
  const id = element.dataset.id;
  const value = element.dataset.value;
  if (state.screen === "mealCreate") captureMealForm();

  if (action === "close-modal") return closeModal();
  if (action === "confirm-yes") { const run = pendingConfirm; closeModal(); if (run) run(); return; }

  if (action === "back") {
    if (state.screen === "editor") { resetDraftImage(); if (state.editingId) { state.detailId = state.editingId; state.editingId = null; return go("detail", "recipes"); } state.editingId = null; const back = state.returnTo || "home"; return go(back, back === "mealCreate" ? "meal" : "recipes"); }
    if (state.screen === "detail") return go(state.returnTo === "search" ? "search" : "home", state.returnTo === "search" ? "search" : "recipes");
    if (state.screen === "recipeSelect") return go("mealCreate", "meal");
    if (state.screen === "mealCreate") { state.draft = null; state.editingPlanId = null; return go("meal", "meal"); }
    return go("home", "recipes");
  }

  if (action === "new-recipe") { state.editingId = null; resetDraftImage(); state.returnTo = state.screen === "recipeSelect" ? "mealCreate" : state.screen; return go("editor"); }
  if (action === "edit-recipe") { const recipe = state.recipes.find((item) => item.id === (id || state.detailId)); if (!recipe) return; state.editingId = recipe.id; resetDraftImage(); draftImage = recipe.image; return go("editor"); }
  if (action === "save-recipe") return saveRecipe();
  if (action === "add-ingredient") return addLine("ingredient");
  if (action === "add-step") return addLine("step");
  if (action === "remove-line") { const line = element.closest(".line"); if (line && line.parentElement.children.length > 1) line.remove(); return; }
  if (action === "clear-cover") { resetDraftImage(); draftImageDirty = true; document.querySelector(".cover__preview").hidden = true; document.querySelector(".cover__drop").hidden = false; return; }
  if (action === "ask-delete-recipe") {
    const recipe = state.recipes.find((item) => item.id === id);
    if (!recipe) return;
    return openConfirm("レシピを削除", esc(recipe.title) + " を削除します。献立に入っている場合はそこからも消えます。この操作は元に戻せません。", "削除する", () => {
      state.recipes = state.recipes.filter((item) => item.id !== id);
      removeDocument("recipes", id);
      if (recipe.image) deleteRecipeImage(id).catch(() => {});
      const emptied = [];
      state.plans.forEach((plan) => {
        if (!plan.items.some((item) => item.id === id)) return;
        plan.items = plan.items.filter((item) => item.id !== id);
        if (plan.items.length || plan.extras.length) patchDocument("plans", plan.id, { items: plan.items });
        else emptied.push(plan.id);
      });
      if (emptied.length) {
        state.plans = state.plans.filter((plan) => !emptied.includes(plan.id));
        removeMany("plans", emptied);
      }
      state.editingId = null;
      state.detailId = null;
      resetDraftImage();
      saveState();
      go("home", "recipes");
      showToast("レシピを削除しました");
    });
  }

  if (action === "detail") { state.detailId = id; state.returnTo = state.screen; return go("detail"); }
  if (action === "mark-cooked") { const recipe = state.recipes.find((item) => item.id === id); if (recipe) { recipe.lastCookedAt = Date.now(); patchDocument("recipes", id, { lastCookedAt: recipe.lastCookedAt }); render(); showToast("作った記録をつけました", "success"); } return; }
  if (action === "add-to-shopping") { const recipe = state.recipes.find((item) => item.id === id); if (!recipe) return; const added = pushShopping(recipe.ingredients, recipe.title); showToast(added ? added + "件を買い物リストに入れました" : "すでに全部入っています", added ? "success" : ""); return; }
  if (action === "quick-plan") { state.editingPlanId = null; state.draft = { date: todayISO(), slot: "夕食", items: [id], extras: [], memo: "" }; return go("mealCreate", "meal"); }

  if (action === "set-category") { state.category = value; saveState(); return render(); }
  if (action === "set-select-category") { state.selectCategory = value; saveState(); return render(); }
  if (action === "open-sort") return openSort();
  if (action === "set-sort") { state.sort = value; saveState(); closeModal(); return render(); }
  if (action === "search-settings") return openSearchSettings();
  if (action === "set-scope") { state.scope = value; saveState(); openSearchSettings(); return render(); }
  if (action === "set-keyword-mode") { state.keywordMode = value; saveState(); openSearchSettings(); return render(); }

  if (action === "new-plan") { state.editingPlanId = null; state.draft = { date: todayISO(), slot: "夕食", items: [], extras: [], memo: "" }; return go("mealCreate", "meal"); }
  if (action === "edit-plan") { const plan = state.plans.find((item) => item.id === id); if (!plan) return; state.editingPlanId = plan.id; state.draft = { date: plan.date, slot: plan.slot, items: plan.items.map((item) => item.id), extras: plan.extras.slice(), memo: plan.memo }; return go("mealCreate", "meal"); }
  if (action === "set-slot") { state.draft.slot = value; saveState(); return render(); }
  if (action === "pick-recipes") { saveState(); return go("recipeSelect", "meal"); }
  if (action === "toggle-pick") { const items = state.draft.items; state.draft.items = items.includes(id) ? items.filter((item) => item !== id) : [...items, id]; saveState(); return render(); }
  if (action === "unpick") { state.draft.items = state.draft.items.filter((item) => item !== id); saveState(); return render(); }
  if (action === "finish-selection") return go("mealCreate", "meal");
  if (action === "add-extra") {
    const input = document.querySelector("#plan-extra");
    const name = (input.value || "").trim();
    if (!name) { showToast("名前を入力してください"); return; }
    state.draft.extras.push(name);
    saveState();
    render();
    const next = document.querySelector("#plan-extra");
    if (next) next.focus();
    return;
  }
  if (action === "remove-extra") { state.draft.extras.splice(Number(element.dataset.index), 1); saveState(); return render(); }
  if (action === "ask-delete-plan") {
    return openConfirm("献立を削除", "この献立を削除します。レシピ自体は残ります。", "削除する", () => {
      state.plans = state.plans.filter((plan) => plan.id !== id);
      removeDocument("plans", id);
      render();
      showToast("献立を削除しました");
    });
  }
  if (action === "save-plan") {
    const draft = state.draft;
    if (!draft.items.length && !draft.extras.length) { showToast("レシピか一品を1つ以上入れてください"); return; }
    const items = draft.items.map((itemId) => state.recipes.find((recipe) => recipe.id === itemId)).filter(Boolean).map(({ id: rid, title }) => ({ id: rid, title }));
    const plan = normalizePlan({ id: state.editingPlanId || newId("plans"), date: draft.date, slot: draft.slot, items, extras: draft.extras, memo: draft.memo });
    const { id: planId, ...planPayload } = plan;
    saveDocument("plans", planId, planPayload);
    applyLocal("plans", plan);
    state.draft = null;
    state.editingPlanId = null;
    saveState();
    go("meal", "meal");
    showToast("献立を保存しました", "success");
    return;
  }

  if (action === "open-shopping-add") return openShoppingAdd();
  if (action === "add-recipe-shopping") { const recipe = state.recipes.find((item) => item.id === id); if (!recipe) return; const added = pushShopping(recipe.ingredients, recipe.title); closeModal(); render(); showToast(added ? added + "件を入れました" : "すでに全部入っています", added ? "success" : ""); return; }
  if (action === "add-shopping-manual") {
    const input = document.querySelector("#shopping-input");
    const name = (input.value || "").trim();
    if (!name) { showToast("品名を入力してください"); return; }
    pushShopping([name], "");
    render();
    const next = document.querySelector("#shopping-input");
    if (next) next.focus();
    return;
  }
  if (action === "remove-shopping") { state.shopping = state.shopping.filter((item) => item.id !== id); removeDocument("shopping", id); return render(); }
  if (action === "clear-done") { const doneIds = state.shopping.filter((item) => item.done).map((item) => item.id); state.shopping = state.shopping.filter((item) => !item.done); removeMany("shopping", doneIds); render(); showToast("購入済みを消しました"); return; }
  if (action === "ask-clear-shopping") {
    return openConfirm("買い物リストを空にする", "リストのすべての品目を削除します。", "空にする", () => {
      const allIds = state.shopping.map((item) => item.id);
      state.shopping = [];
      removeMany("shopping", allIds);
      render();
      showToast("買い物リストを空にしました");
    });
  }

  if (action === "sign-in") { signIn().catch((error) => showToast("ログインできませんでした（" + (error.code || "error") + "）", "danger")); return; }
  if (action === "sign-out") {
    return openConfirm("ログアウト", "この端末からログアウトします。データはアカウントに残ります。", "ログアウト", () => {
      signOutUser().catch(() => showToast("ログアウトできませんでした", "danger"));
    });
  }
  if (action === "set-theme") { state.theme = value; saveState(); return render(); }
  if (action === "export-data") return exportData();
  if (action === "ask-reset") {
    return openConfirm("すべてのデータを削除", "アカウントに保存されているレシピ・献立・買い物リストをすべて消します。この操作は元に戻せません。", "すべて削除する", () => {
      const recipeIds = state.recipes.map((item) => item.id);
      const imageIds = state.recipes.filter((item) => item.image).map((item) => item.id);
      removeMany("recipes", recipeIds);
      removeMany("plans", state.plans.map((item) => item.id));
      removeMany("shopping", state.shopping.map((item) => item.id));
      imageIds.forEach((imageId) => deleteRecipeImage(imageId).catch(() => {}));
      state.recipes = [];
      state.plans = [];
      state.shopping = [];
      state.draft = null;
      saveState();
      go("home", "recipes");
      showToast("すべて削除しました");
    });
  }
}

function switchTab(tab) {
  if (tab === "recipes") return go("home", "recipes");
  if (tab === "search") return go("search", "search");
  if (tab === "meal") return go("meal", "meal");
  if (tab === "shopping") return go("shopping", "shopping");
  if (tab === "settings") return go("settings", "settings");
}

document.addEventListener("click", (event) => {
  const tabButton = event.target.closest("[data-tab]");
  if (tabButton) return switchTab(tabButton.dataset.tab);
  const target = event.target.closest("[data-action]");
  if (!target) return;
  if (target.tagName === "INPUT") return;
  if (target.closest("#modal-root") && target.dataset.action === "close-modal" && event.target !== target) return;
  handleAction(target);
});

document.addEventListener("submit", (event) => {
  if (event.target.id !== "recipe-form") return;
  event.preventDefault();
  saveRecipe();
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id === "cover-input" && target.files && target.files[0]) {
    readImage(target.files[0]).then(({ blob, url }) => {
      if (draftImage && draftImage.startsWith("blob:")) URL.revokeObjectURL(draftImage);
      draftImage = url;
      draftImageBlob = blob;
      draftImageDirty = true;
      document.querySelector("#cover-preview").src = url;
      document.querySelector(".cover__preview").hidden = false;
      document.querySelector(".cover__drop").hidden = true;
    }).catch(() => showToast("画像を読み込めませんでした", "danger"));
    return;
  }
  if (target.id === "import-input" && target.files && target.files[0]) {
    const file = target.files[0];
    target.value = ""; /* 確認をやめた後に同じファイルを選び直せるようにする */
    return importData(file);
  }
  if (target.dataset.action === "toggle-shopping") {
    const item = state.shopping.find((entry) => entry.id === target.dataset.id);
    if (item) { item.done = target.checked; patchDocument("shopping", item.id, { done: item.done }); render(); }
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id !== "search-input") return;
  state.query = event.target.value;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    saveState();
    const results = document.querySelector("#search-results");
    if (results) results.innerHTML = searchResultsHtml();
  }, 160);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.querySelector("#modal-root").innerHTML) closeModal();
});

/* ---------- 起動と同期 ---------- */

/* フォーム入力中に購読が届いても、入力途中の値を消さないように描き直しを遅らせる。 */
function dataChanged() {
  if (["editor", "mealCreate"].includes(state.screen)) return;
  render();
}

function handleSubscribeError(error) {
  if (error && (error.code === "unavailable" || error.code === "failed-precondition")) return;
  showToast("データを読み込めませんでした（" + ((error && error.code) || "error") + "）", "danger");
  if (phase === "syncing") { phase = "ready"; render(); offerLegacyImport(); }
}

function subscribeAll() {
  unsubscribers.forEach((stop) => stop());
  unsubscribers = [];
  const arrived = { recipes: false, plans: false, shopping: false };
  const settle = (name, meta) => {
    arrived[name] = true;
    netStatus.pending = Boolean(meta && meta.pending);
    if (phase === "syncing" && arrived.recipes && arrived.plans && arrived.shopping) {
      phase = "ready";
      render();
      offerLegacyImport();
      return;
    }
    if (phase === "ready") dataChanged();
  };
  unsubscribers.push(subscribe("recipes", (items, meta) => {
    state.recipes = items.map(normalizeRecipe);
    settle("recipes", meta);
  }, handleSubscribeError));
  unsubscribers.push(subscribe("plans", (items, meta) => {
    state.plans = items.map(normalizePlan);
    settle("plans", meta);
  }, handleSubscribeError));
  unsubscribers.push(subscribe("shopping", (items, meta) => {
    state.shopping = items.map(normalizeShoppingItem).sort((a, b) => a.createdAt - b.createdAt);
    settle("shopping", meta);
  }, handleSubscribeError));
  /* 初回だけサーバー応答を待つが、遅いときは手元のキャッシュで先に画面を出す。 */
  window.setTimeout(() => { if (phase === "syncing") { phase = "ready"; render(); offerLegacyImport(); } }, 6000);
}

function offerLegacyImport() {
  const data = legacyData;
  legacyData = null;
  if (!data) return;
  if (state.recipes.length || state.plans.length || state.shopping.length) { localStorage.removeItem(LEGACY_KEY); return; }
  openConfirm("前のデータを引き継ぐ",
    "この端末に、アカウントを使う前のデータが残っています（レシピ" + data.recipes.length + "件・献立" + data.plans.length + "件・買い物" + data.shopping.length + "件）。今のアカウントに取り込みますか。写真は引き継がれません。",
    "取り込む", () => {
      const recipes = data.recipes.map((recipe) => ({ ...recipe, image: "" }));
      const shopping = data.shopping.map(normalizeShoppingItem);
      state.recipes = recipes;
      state.plans = data.plans;
      state.shopping = shopping;
      saveMany("recipes", recipes);
      saveMany("plans", data.plans);
      saveMany("shopping", shopping);
      localStorage.removeItem(LEGACY_KEY);
      render();
      showToast("引き継ぎました", "success");
    });
}

async function boot() {
  if (!configured) { phase = "setup"; render(); return; }
  onWriteError((error) => showToast("保存できませんでした（" + (error.code || "error") + "）", "danger"));
  window.addEventListener("online", () => { netStatus.offline = false; renderNetBanner(); });
  window.addEventListener("offline", () => { netStatus.offline = true; renderNetBanner(); });
  render();
  await consumeRedirectResult();
  watchAuth((user) => {
    authUser = user;
    unsubscribers.forEach((stop) => stop());
    unsubscribers = [];
    if (!user) {
      setUser(null);
      state.recipes = [];
      state.plans = [];
      state.shopping = [];
      phase = "signin";
      render();
      return;
    }
    setUser(user.uid);
    legacyData = readLegacyData();
    phase = "syncing";
    render();
    subscribeAll();
  });
}

boot();
