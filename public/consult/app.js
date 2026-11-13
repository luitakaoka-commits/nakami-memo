/* 相談AI（くらしノートの4つ目。2026-11-13 ユーザー要望）。
 * 形は「ことのはの鏡」の相談にならう：相談をいくつでも作れる・名前の変更と削除・30日で自動整理・
 * 返答は少しずつ流れて途中で止められる・書きかけは相談ごとに残る・返答ごとに参考にした記録を出す。
 * 相談は本人だけの場所（users/{uid}/consultThreads）に置き、同居人とは共有しない。 */

import {
  collection, doc, getDocs, setDoc, updateDoc, query, orderBy, limit, startAfter, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, getIdToken, signIn, watchAuth, consumeRedirectResult } from "../recipe/firebase.js";
import { buildConsultContext, japanToday } from "./context.js";
import { isExpiredThread, renderAnswer, threadTitleFrom } from "./chat-format.js";

const PAGE = 40;
const CONTEXT_TTL_MS = 3 * 60_000;
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const uid8 = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const state = {
  uid: "",
  threads: [],
  currentId: "",
  messages: [],
  oldest: null,
  hasOlder: false,
  controller: null,
  context: null,
  draftTimer: 0,
  menuId: "",
  deleteArmed: false,
};

// 相談は、くらしノートを開いたときの起動先（public/shared/last-app.js）にはしない。いつもの3アプリから開く

/* ---------- 保存先 ---------- */
const threadsCol = () => collection(db, "users", state.uid, "consultThreads");
const threadDoc = (id) => doc(db, "users", state.uid, "consultThreads", id);
const messagesCol = (id) => collection(db, "users", state.uid, "consultThreads", id, "messages");

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("visible"), 2600);
}

/* ---------- 相談の一覧 ---------- */
async function loadThreads() {
  const snapshot = await getDocs(query(threadsCol(), orderBy("updatedAt", "desc"), limit(100)));
  const now = Date.now();
  const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  // 30日使っていない相談は自動で整理する（ことのはの鏡と同じ）。消すのは本人の端末から本人の記録だけ
  const expired = rows.filter((thread) => isExpiredThread(Number(thread.updatedAt), now) && thread.id !== state.currentId);
  for (const thread of expired) await deleteThread(thread.id, { silent: true }).catch((error) => console.warn("[相談] 整理できません", error));
  state.threads = rows.filter((thread) => !expired.includes(thread));
  renderThreads();
}

function renderThreads() {
  $("#threads").innerHTML = state.threads.map((thread) => `<div class="thread-row" ${thread.id === state.currentId ? 'aria-current="page"' : ""}>
      <button type="button" class="thread-open" data-thread="${esc(thread.id)}"><span>${esc(thread.title || "新しい相談")}</span><small>${esc(new Date(Number(thread.updatedAt) || 0).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }))}</small></button>
      <button type="button" class="icon-button thread-more" data-thread-menu="${esc(thread.id)}" aria-label="${esc(thread.title || "相談")}の操作">…</button>
    </div>`).join("") || '<p class="support retention">まだ相談はありません。</p>';
}

async function openThread(id) {
  stopStreaming();
  saveDraftNow();
  state.currentId = id;
  state.messages = [];
  state.oldest = null;
  state.hasOlder = false;
  const thread = state.threads.find((item) => item.id === id);
  $("#thread-title").textContent = thread?.title || "新しい相談";
  $("#prompt").value = thread?.draft || "";
  autosize();
  renderThreads();
  renderMessages();
  if (id) await loadOlder();
  scrollToEnd();
}

async function loadOlder() {
  const id = state.currentId;
  const constraints = [orderBy("createdAt", "desc"), limit(PAGE)];
  if (state.oldest) constraints.push(startAfter(state.oldest));
  const snapshot = await getDocs(query(messagesCol(id), ...constraints));
  if (id !== state.currentId) return;
  const older = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).reverse();
  state.oldest = snapshot.docs[snapshot.docs.length - 1] || state.oldest;
  state.hasOlder = snapshot.docs.length === PAGE;
  const scroller = $("#main");
  const before = scroller.scrollHeight;
  state.messages = [...older, ...state.messages];
  renderMessages();
  scroller.scrollTop += scroller.scrollHeight - before;
}

function newThread() {
  openThread("");
  closeSidebar();
  $("#prompt").focus();
}

async function deleteThread(id, { silent = false } = {}) {
  // メッセージを先に消してから相談を消す（500件ずつ）
  for (;;) {
    const snapshot = await getDocs(query(messagesCol(id), limit(400)));
    if (!snapshot.size) break;
    const batch = writeBatch(db);
    snapshot.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  const batch = writeBatch(db);
  batch.delete(threadDoc(id));
  await batch.commit();
  state.threads = state.threads.filter((thread) => thread.id !== id);
  if (state.currentId === id) await openThread("");
  renderThreads();
  if (!silent) toast("相談を削除しました");
}

/* ---------- やりとりの表示 ---------- */
function messageHtml(message, index) {
  if (message.role === "user") return `<article class="turn user"><div class="bubble">${esc(message.text)}</div></article>`;
  const meta = [];
  if (message.sources?.length) meta.push(`<span>参考にした記録</span>${message.sources.map((name) => `<span class="chip">${esc(name)}</span>`).join("")}`);
  if (message.fallback && message.model) meta.push(`<span>予備のAI（${esc(message.model)}）で答えました</span>`);
  if (message.status === "stopped") meta.push("<span>途中で止めました</span>");
  const error = message.status === "error"
    ? `<div class="turn-error"><p class="status danger">${esc(message.error || "答えられませんでした。")}</p><button type="button" class="text-button" data-retry="${index}">もう一度</button></div>`
    : "";
  const waiting = message.status === "reading" ? '<p class="support">記録を読んでいます…</p>' : message.status === "streaming" && !message.text ? '<p class="support">考えています…</p>' : "";
  return `<article class="turn assistant"><div class="bubble answer${message.status === "streaming" ? " typing" : ""}">${waiting}${renderAnswer(message.text)}</div>${meta.length ? `<p class="turn-meta">${meta.join("")}</p>` : ""}${error}</article>`;
}

function renderMessages() {
  $("#messages").innerHTML = state.messages.map(messageHtml).join("");
  $("#older-wrap").hidden = !state.hasOlder;
  $("#welcome").hidden = state.messages.length > 0;
}

function renderLast() {
  const nodes = $("#messages").children;
  const index = state.messages.length - 1;
  if (nodes.length !== state.messages.length) { renderMessages(); return; }
  nodes[index].outerHTML = messageHtml(state.messages[index], index);
}

function nearEnd() {
  const node = $("#main");
  return node.scrollHeight - node.scrollTop - node.clientHeight < 120;
}
function scrollToEnd() {
  const node = $("#main");
  node.scrollTop = node.scrollHeight;
}

/* ---------- 送る・止める ---------- */
async function contextForConsult() {
  if (state.context && Date.now() - state.context.at < CONTEXT_TTL_MS) return state.context.value;
  const value = await buildConsultContext(state.uid);
  state.context = { at: Date.now(), value };
  return value;
}

async function ensureThread(firstText) {
  if (state.currentId) return state.currentId;
  const id = uid8();
  const now = Date.now();
  const thread = { title: threadTitleFrom(firstText), createdAt: now, updatedAt: now, draft: "" };
  await setDoc(threadDoc(id), thread);
  state.threads.unshift({ id, ...thread });
  state.currentId = id;
  $("#thread-title").textContent = thread.title;
  renderThreads();
  return id;
}

function setStreaming(on) {
  $("#send").hidden = on;
  $("#stop").hidden = !on;
}

function stopStreaming() {
  state.controller?.abort();
}

async function send(text) {
  const content = String(text || "").trim();
  if (!content || state.controller) return;
  const id = await ensureThread(content).catch((error) => { console.error(error); toast("相談を作れませんでした。通信を確かめてください"); return ""; });
  if (!id) return;
  const user = { id: uid8(), role: "user", text: content, createdAt: Date.now() };
  state.messages.push(user);
  $("#prompt").value = "";
  autosize();
  renderMessages();
  scrollToEnd();
  setDoc(doc(messagesCol(id), user.id), { role: user.role, text: user.text, createdAt: user.createdAt }).catch((error) => console.error("[相談] 保存できません", error));
  updateDoc(threadDoc(id), { updatedAt: Date.now(), draft: "" }).catch(() => {});
  await answer(id);
}

/** 最後の本人の文に答える（「もう一度」でも使う） */
async function answer(id) {
  const reply = { id: uid8(), role: "assistant", text: "", createdAt: Date.now(), status: "reading", sources: [] };
  state.messages.push(reply);
  renderMessages();
  scrollToEnd();
  const controller = new AbortController();
  state.controller = controller;
  setStreaming(true);
  try {
    const context = await contextForConsult();
    reply.sources = context.sources;
    reply.status = "streaming";
    renderLast();
    const token = await getIdToken();
    const history = state.messages.filter((message) => message !== reply && message.status !== "error" && message.text).map(({ role, text }) => ({ role, text }));
    const response = await fetch("/api/consult", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: history, context: context.text, sources: context.sources, today: context.today }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `答えられませんでした（${response.status}）`);
    }
    reply.model = response.headers.get("X-Consult-Model") || "";
    reply.fallback = response.headers.get("X-Consult-Fallback") === "1";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const follow = nearEnd();
      reply.text += decoder.decode(value, { stream: true });
      renderLast();
      if (follow) scrollToEnd();
    }
    reply.text += decoder.decode();
    reply.status = reply.text.trim() ? "done" : "error";
    if (!reply.text.trim()) reply.error = "返事が空でした。もう一度お試しください。";
  } catch (error) {
    if (controller.signal.aborted) reply.status = reply.text ? "stopped" : "error";
    else reply.status = "error";
    if (reply.status === "error") reply.error = controller.signal.aborted ? "止めました。" : (error.message || "答えられませんでした。");
  } finally {
    state.controller = null;
    setStreaming(false);
    renderLast();
  }
  if (reply.status === "done" || reply.status === "stopped") {
    const saved = { role: "assistant", text: reply.text, createdAt: reply.createdAt, status: reply.status, sources: reply.sources, model: reply.model || "", fallback: Boolean(reply.fallback) };
    setDoc(doc(messagesCol(id), reply.id), saved).catch((error) => console.error("[相談] 保存できません", error));
    const now = Date.now();
    updateDoc(threadDoc(id), { updatedAt: now }).catch(() => {});
    const thread = state.threads.find((item) => item.id === id);
    if (thread) { thread.updatedAt = now; state.threads.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt)); renderThreads(); }
  }
}

function retry(index) {
  if (state.controller || index !== state.messages.length - 1) return;
  state.messages.pop();
  renderMessages();
  if (state.currentId && state.messages[state.messages.length - 1]?.role === "user") answer(state.currentId);
}

/* ---------- 書きかけ ---------- */
function saveDraftNow() {
  clearTimeout(state.draftTimer);
  const thread = state.threads.find((item) => item.id === state.currentId);
  const draft = $("#prompt").value;
  if (!thread || thread.draft === draft) return;
  thread.draft = draft;
  updateDoc(threadDoc(thread.id), { draft }).catch(() => {});
}

function autosize() {
  const area = $("#prompt");
  area.style.height = "auto";
  area.style.height = `${Math.min(area.scrollHeight, window.innerHeight * 0.4)}px`;
}

/* ---------- メニュー ---------- */
function openSidebar() {
  renderThreads();
  $("#sidebar").showModal();
  $("#menu-open").setAttribute("aria-expanded", "true");
  document.body.classList.add("modal-open");
}
function closeSidebar() {
  if ($("#sidebar").open) $("#sidebar").close();
}
$("#sidebar").addEventListener("close", () => {
  $("#menu-open").setAttribute("aria-expanded", "false");
  document.body.classList.remove("modal-open");
  $("#menu-open").focus();
});
$("#sidebar").addEventListener("click", (event) => {
  if (event.target === $("#sidebar")) { closeSidebar(); return; }
  const open = event.target.closest("[data-thread]");
  if (open) { openThread(open.dataset.thread); closeSidebar(); return; }
  const more = event.target.closest("[data-thread-menu]");
  if (more) openThreadMenu(more.dataset.threadMenu);
});

function openThreadMenu(id) {
  const thread = state.threads.find((item) => item.id === id);
  if (!thread) return;
  state.menuId = id;
  state.deleteArmed = false;
  $("#thread-menu-title").textContent = thread.title || "相談";
  $("#rename-input").value = thread.title || "";
  $("#delete-thread").textContent = "この相談を削除";
  $("#thread-menu").showModal();
}
$("#thread-menu").addEventListener("click", (event) => {
  if (event.target === $("#thread-menu") || event.target.closest("[data-close]")) $("#thread-menu").close();
});
$("#rename-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = $("#rename-input").value.trim().slice(0, 40);
  const thread = state.threads.find((item) => item.id === state.menuId);
  if (!title || !thread) return;
  thread.title = title;
  if (thread.id === state.currentId) $("#thread-title").textContent = title;
  renderThreads();
  $("#thread-menu").close();
  await updateDoc(threadDoc(thread.id), { title }).catch(() => toast("名前を保存できませんでした"));
});
$("#delete-thread").addEventListener("click", async () => {
  // 1回目で確かめ、2回目で消す（ブラウザの確認ダイアログは使わない）
  if (!state.deleteArmed) { state.deleteArmed = true; $("#delete-thread").textContent = "もう一度押すと削除します（元に戻せません）"; return; }
  const id = state.menuId;
  $("#thread-menu").close();
  await deleteThread(id).catch((error) => { console.error(error); toast("削除できませんでした"); });
});

/* ---------- 入力 ---------- */
$("#composer").addEventListener("submit", (event) => { event.preventDefault(); send($("#prompt").value); });
$("#prompt").addEventListener("input", () => {
  autosize();
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(saveDraftNow, 600);
});
$("#prompt").addEventListener("keydown", (event) => {
  // パソコンでは Enter で送り、Shift+Enter で改行。スマホでは Enter は改行（送るボタンで送る）
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !window.matchMedia("(pointer: coarse)").matches) {
    event.preventDefault();
    send($("#prompt").value);
  }
});
$("#stop").addEventListener("click", stopStreaming);
$("#menu-open").addEventListener("click", openSidebar);
$("#menu-close").addEventListener("click", closeSidebar);
$("#new-chat").addEventListener("click", newThread);
$("#sidebar-new").addEventListener("click", newThread);
$("#older").addEventListener("click", () => loadOlder().catch(() => toast("読み込めませんでした")));
$("#messages").addEventListener("click", (event) => {
  const button = event.target.closest("[data-retry]");
  if (button) retry(Number(button.dataset.retry));
});
document.querySelectorAll(".suggestion").forEach((button) => button.addEventListener("click", () => send(button.textContent)));
window.addEventListener("pagehide", saveDraftNow);

/* ---------- ログイン ---------- */
$("#login-button").addEventListener("click", async () => {
  $("#login-error").hidden = true;
  try { await signIn(); } catch (error) {
    $("#login-error").textContent = `ログインできませんでした（${error.code || error.message}）`;
    $("#login-error").hidden = false;
  }
});
consumeRedirectResult();
watchAuth(async (user) => {
  $("#login").hidden = Boolean(user);
  $("#app").hidden = !user;
  if (!user) { state.uid = ""; return; }
  if (state.uid === user.uid) return;
  state.uid = user.uid;
  state.context = null;
  $("#welcome-date").textContent = new Date(`${japanToday()}T12:00:00`).toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
  await openThread("");
  await loadThreads().catch((error) => { console.error("[相談] 一覧を読めません", error); toast("相談の一覧を読めませんでした"); });
  // 記録は先に読み始めておく（最初の返答を早くするため）
  contextForConsult().then((context) => {
    $("#welcome-sources").textContent = context.sources.length
      ? `${context.sources.join("・")}を見ながら答えます。`
      : "記録を読めませんでした。一般的な答えになります。";
  }).catch(() => {});
});
