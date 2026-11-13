/* 相談AIに渡す「本人の記録」を読み込む（2026-11-13）。
 * どれも本人の権限（Firestore のルール）のまま、画面の中で読む。サーバーへは要約した文章だけを送る。
 * 1つ読めなくても、ほかの記録で相談できるようにする（読めなかったものは sources に入れない）。 */

import {
  collection, doc, getDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "../recipe/firebase.js";
import { formatHealth, formatInventory, formatMoney, formatRecipes } from "./context-format.js";

/** 日本の今日（YYYY-MM-DD） */
export function japanToday() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

/* お金管理の計算部品（お金管理の画面と同じもの）。読み込みは1回だけ */
const MONEY_SCRIPTS = ["finance-engine.js", "redesign-legacy-adapter.js", "redesign-readiness.js", "redesign-deadline.js", "redesign-bill-lifecycle.js", "redesign-refund.js", "daily-finance.js"];
let moneyScripts = null;
function loadMoneyScripts() {
  if (!moneyScripts) {
    moneyScripts = MONEY_SCRIPTS.reduce((previous, name) => previous.then(() => new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `/money/${name}`;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`${name} を読めません`));
      document.head.append(script);
    })), Promise.resolve());
  }
  return moneyScripts;
}

/** 家計（お金管理の共有スペース）。お金管理で最後に開いたものを優先し、無ければ自分が持ち主のもの */
async function readMoneyState(uid) {
  let id = "";
  try { id = localStorage.getItem("okane-active-workspace") || ""; } catch { /* 読めなければ探す */ }
  if (id) {
    const snapshot = await getDoc(doc(db, "workspaces", id)).catch(() => null);
    if (snapshot?.exists() && (snapshot.data().memberUids || []).includes(uid)) return snapshot.data().state || null;
  }
  const found = await getDocs(query(collection(db, "workspaces"), where("memberUids", "array-contains", uid)));
  const rows = found.docs.map((item) => item.data()).sort((a, b) => Number(b.ownerUid === uid) - Number(a.ownerUid === uid));
  return rows[0]?.state || null;
}

async function moneyContext(uid, today) {
  const [state] = await Promise.all([readMoneyState(uid), loadMoneyScripts()]);
  if (!state) return "";
  let view = null;
  let summary = null;
  try { view = window.DailyFinance.overview({ state, today, candidates: [] }); } catch (error) { console.warn("[相談] 使える額を計算できません", error); }
  const month = today.slice(0, 7);
  try { summary = window.FinanceEngine.summarizePeriod(state.transactions || [], window.FinanceEngine.calendarMonthRange(month), { basis: "real" }); } catch (error) { console.warn("[相談] 今月の収支を計算できません", error); }
  return formatMoney({ state, view, summary, today, monthLabel: `${Number(month.slice(5))}月` });
}

/** 在庫・レシピの置き場所（同居人と共有していれば家、していなければ自分。つくりおきノートの store.js と同じ決め方） */
async function spacePath(uid) {
  const profile = await getDoc(doc(db, "users", uid)).catch(() => null);
  const id = profile?.exists() ? profile.data().householdId : null;
  if (id) {
    const home = await getDoc(doc(db, "households", id)).catch(() => null);
    if (home?.exists() && (home.data().memberUids || []).includes(uid)) return ["households", id];
  }
  return ["users", uid];
}

const toDay = (value) => {
  if (!value) return "";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10) : "";
};

async function inventoryContext(space, today) {
  const [items, locations] = await Promise.all([
    getDocs(collection(db, ...space, "items")),
    getDocs(collection(db, ...space, "locations")).catch(() => null),
  ]);
  const places = new Map((locations?.docs || []).map((item) => [item.id, item.data().name || ""]));
  return formatInventory(items.docs.map((item) => {
    const data = item.data();
    return { name: data.name, quantity: data.quantity, unit: data.unit, category: data.category, expiration: toDay(data.expirationDate), location: places.get(data.locationId) || "" };
  }), today);
}

async function recipeContext(space, today) {
  const [recipes, plans, shopping] = await Promise.all(["recipes", "plans", "shopping"].map((name) => getDocs(collection(db, ...space, name)).catch(() => null)));
  const recipeRows = (recipes?.docs || []).map((item) => ({ id: item.id, ...item.data() }));
  const titles = new Map(recipeRows.map((recipe) => [recipe.id, recipe.title]));
  return formatRecipes({
    recipes: recipeRows.map((recipe) => ({ title: recipe.title || "無題", category: recipe.category || "", lastCookedAt: Number(recipe.lastCookedAt) || 0 })),
    plans: (plans?.docs || []).map((item) => item.data()).map((plan) => ({
      date: plan.date || "", slot: plan.slot || "",
      // 献立の1品は、レシピの id（消したレシピなら残っている title）。つくりおきノートの planItemTitle と同じ
      titles: [...(plan.items || []).map((entry) => titles.get(entry.id) || entry.title || ""), ...(plan.extras || [])].filter(Boolean),
    })),
    shopping: (shopping?.docs || []).map((item) => ({ name: item.data().name || "", done: Boolean(item.data().done) })),
  }, today);
}

async function healthContext(uid, today) {
  const docs = await getDocs(collection(db, "users", uid, "health"));
  return formatHealth(docs.docs.map((item) => item.data()), today);
}

/** 4つの記録を読み、要約と、読めた記録の名前を返す */
export async function buildConsultContext(uid) {
  const today = japanToday();
  const space = await spacePath(uid).catch(() => ["users", uid]);
  const parts = [
    ["お金管理", moneyContext(uid, today)],
    ["なかみメモの在庫", inventoryContext(space, today)],
    ["つくりおきノート", recipeContext(space, today)],
    ["からだの記録", healthContext(uid, today)],
  ];
  const settled = await Promise.allSettled(parts.map(([, promise]) => promise));
  const sources = [];
  const texts = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) { sources.push(parts[index][0]); texts.push(result.value); }
    else if (result.status === "rejected") console.warn(`[相談] ${parts[index][0]}を読めません`, result.reason);
  });
  return { today, sources, text: texts.join("\n\n") };
}
