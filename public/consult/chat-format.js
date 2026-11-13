/* 相談AIの画面で使う、ネットワークを使わない部分（2026-11-13）。
 * threadTitleFrom・isExpiredThread・RETENTION_DAYS はサーバー側の src/lib/consult/consult-core.ts と同じもの。
 * src/lib/consult/consult-core.test.mjs が両方を突き合わせるので、片方だけ直すと落ちる。 */

export const RETENTION_DAYS = 30;

export function threadTitleFrom(firstMessage) {
  const line = String(firstMessage || "").replace(/\s+/g, " ").trim();
  if (!line) return "新しい相談";
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

export function isExpiredThread(updatedAtMillis, nowMillis, days = RETENTION_DAYS) {
  return Number.isFinite(updatedAtMillis) && updatedAtMillis > 0 && nowMillis - updatedAtMillis > days * 86_400_000;
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

/** 行の中の **太字** と `コード` だけを整える（ほかの記号はそのまま文字として出す） */
function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * AI の返答を HTML にする。必ずエスケープしてから、段落・箇条書き（- ・ * ・ 1.）・見出し（#）・太字だけを整える。
 * リンクや画像は作らない（返答にURLが書かれても、ただの文字として出す）。
 */
export function renderAnswer(text) {
  const blocks = [];
  let list = null;
  let paragraph = [];
  const flushParagraph = () => { if (paragraph.length) { blocks.push(`<p>${paragraph.map(inline).join("<br>")}</p>`); paragraph = []; } };
  const flushList = () => { if (list) { blocks.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (const raw of String(text || "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*・]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)．]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,4}\s+(.*)$/.exec(line);
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    if (heading) { flushParagraph(); flushList(); blocks.push(`<h3>${inline(heading[1])}</h3>`); continue; }
    if (bullet || numbered) {
      flushParagraph();
      const tag = numbered ? "ol" : "ul";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((bullet || numbered)[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks.join("");
}
