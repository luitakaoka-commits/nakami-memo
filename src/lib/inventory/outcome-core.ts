/**
 * 「使い切った」「捨てた」を記録するための、ネットワークを使わない部分（Phase 4 手B）。
 *
 * 無駄は買った瞬間には決まらない。同じ198円のもやしでも、使い切れば無駄ではなく、
 * 腐らせれば198円まるごとが無駄になる。だから在庫がどうなったかを、
 * お金管理のレシート明細まで返さないと「ムダ支出」は出せない。
 *
 * ここの値（理由と結末の対応、無駄と数える割合）は、お金管理側と一字一句そろえること。
 * ずれると同じ操作で違う金額が出る。`outcome-core.test.mjs` が両方のファイルを読んで突き合わせる。
 */

/** 在庫がどうなったか。お金管理の finance-engine.js の WASTE_RATIO と同じ並び。 */
export const OUTCOMES = ["in_stock", "consumed", "expired", "discarded", "unused", "unnecessary"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** outcome ごとの「無駄と数える割合」。お金管理の WASTE_RATIO と同じ値にすること。 */
export const WASTE_RATIO: Record<Outcome, number> = {
  in_stock: 0,
  consumed: 0,
  expired: 1,
  discarded: 1,
  unused: 0.5,
  unnecessary: 1,
};

/** 「捨てた」の理由と、そこから決まる結末。お金管理の DISCARD_REASONS と同じ並びにすること。 */
export const DISCARD_REASONS: ReadonlyArray<{ reason: string; outcome: Outcome }> = [
  { reason: "期限切れ", outcome: "expired" },
  { reason: "使わなかった", outcome: "discarded" },
  { reason: "買いすぎ", outcome: "unused" },
  { reason: "好みでなかった", outcome: "unnecessary" },
];

/**
 * 「使い切った／捨てた」を出す在庫のカテゴリ。
 * 工具や書類に「使い切った」は出しても押されないので、使って減るものだけに絞る。
 * レシートから入れたものは、カテゴリに関わらず出す（お金管理へ返す先があるため）。
 */
export const CONSUMABLE_CATEGORIES = ["食品", "飲料", "調味料", "日用品", "洗剤", "薬", "掃除用品", "電池"] as const;

export type OutcomeTarget = {
  quantity?: number;
  category?: string;
  purchaseRef?: string;
  purchaseWorkspaceId?: string;
};

/** その在庫に「使い切った／捨てた」を出すか。数量0のものはもう出さない（押す意味がない）。 */
export function canRecordOutcome(item: OutcomeTarget | null | undefined): boolean {
  if (!item) return false;
  if (Number(item.quantity ?? 0) <= 0) return false;
  if (item.purchaseWorkspaceId || item.purchaseRef) return true;
  return (CONSUMABLE_CATEGORIES as readonly string[]).includes(String(item.category ?? ""));
}

/** 「捨てた」の理由から結末を決める。知らない理由は「使わず処分」に寄せる。 */
export function outcomeOfDiscardReason(reason: string): Outcome {
  return DISCARD_REASONS.find((entry) => entry.reason === reason)?.outcome ?? "discarded";
}

export type OutcomeChoice = { kind: "consumed" } | { kind: "discarded"; reason: string };

export type ItemOutcomePatch = {
  quantity: 0;
  outcome: Outcome;
  outcomeAt: string;
  outcomeReason: string;
};

/**
 * 在庫側に書く内容。
 * **数量を0にするだけで、モノ自体は消さない。** 同じものをまた買うので、
 * 消してしまうと次に買ったときに名前から作り直すことになり、買い直しの回数も分からなくなる。
 */
export function itemOutcomePatch(choice: OutcomeChoice, now: Date): ItemOutcomePatch {
  const outcome = choice.kind === "consumed" ? "consumed" : outcomeOfDiscardReason(choice.reason);
  return {
    quantity: 0,
    outcome,
    outcomeAt: now.toISOString(),
    outcomeReason: choice.kind === "consumed" ? "" : choice.reason,
  };
}

/** 明細1行の無駄金額。お金管理の wasteAmountOf と同じ計算（端数は切り捨て）。 */
export function wasteAmountOf(amount: unknown, outcome: Outcome): number {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const ratio = WASTE_RATIO[outcome];
  if (!ratio) return 0;
  return ratio === 1 ? value : Math.floor(value * ratio);
}

export type ReceiptLinePatch = {
  outcome: Outcome;
  outcomeAt: string;
  outcomeReason: string;
  wasteAmount: number;
  updatedAt: string;
};

/** お金管理のレシート明細に書き戻す内容。金額はその行のものを使う。 */
export function receiptLinePatch(line: { amount?: unknown }, patch: ItemOutcomePatch): ReceiptLinePatch {
  return {
    outcome: patch.outcome,
    outcomeAt: patch.outcomeAt,
    outcomeReason: patch.outcomeReason,
    wasteAmount: wasteAmountOf(line?.amount, patch.outcome),
    updatedAt: patch.outcomeAt,
  };
}

export type ReceiptLineRef = { id: string; receiptId?: string; amount?: unknown };

/**
 * 1つの在庫に結びついたレシート明細の全部に返す内容（2026-09-15）。
 *
 * お金管理は値引き行をすぐ上の商品にまとめて扱い、在庫に入れるときは値引き行にも同じ在庫のIDを書く。
 * だから「198円のもやし」と「値引 −50円」の2行が見つかる。行ごとに無駄を出すと 198円 になってしまうので、
 * レシートごとに金額を足し（148円）、いちばん金額の大きい行（商品の行）にまとめて無駄を載せ、ほかの行は0円にする。
 * 結末（使い切った・捨てた）は全部の行に同じものを書く。
 */
export function receiptLinePatches(lines: ReceiptLineRef[], patch: ItemOutcomePatch) {
  const byReceipt = new Map<string, ReceiptLineRef[]>();
  (lines || []).forEach((line) => {
    const key = String(line?.receiptId ?? "");
    byReceipt.set(key, [...(byReceipt.get(key) ?? []), line]);
  });
  const patches: Array<{ id: string; patch: ReceiptLinePatch }> = [];
  let wasteTotal = 0;
  byReceipt.forEach((group) => {
    const net = group.reduce((sum, line) => sum + (Number.isFinite(Number(line.amount)) ? Number(line.amount) : 0), 0);
    const primary = group.reduce((best, line) => (Number(line.amount) > Number(best.amount) ? line : best), group[0]);
    group.forEach((line) => {
      const linePatch = receiptLinePatch({ amount: line === primary ? net : 0 }, patch);
      if (line === primary) wasteTotal += linePatch.wasteAmount;
      patches.push({ id: line.id, patch: linePatch });
    });
  });
  return { patches, wasteTotal };
}

/**
 * また買って在庫が戻ったときに消す内容。
 * 「使い切った」の印が残ったままだと、棚にあるのに使い切った扱いのままになる。
 */
export const OUTCOME_RESET = { outcome: "in_stock" as Outcome, outcomeAt: "", outcomeReason: "" };

/** 数量が1以上に戻ったら、結末の印を消す（編集で数量を入れ直したときなど）。 */
export function shouldResetOutcome(item: OutcomeTarget | null | undefined, nextQuantity: unknown): boolean {
  const outcome = (item as { outcome?: string } | null | undefined)?.outcome;
  if (!outcome || outcome === "in_stock") return false;
  return Number(nextQuantity ?? 0) > 0;
}

/** 画面に出す短い説明。記録したあとカードに出す。 */
export function outcomeLabel(outcome: string | undefined, reason?: string): string {
  if (!outcome || outcome === "in_stock") return "";
  if (outcome === "consumed") return "使い切った";
  return reason ? `捨てた（${reason}）` : "捨てた";
}
