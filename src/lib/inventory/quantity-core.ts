/**
 * 在庫の数量を、一覧から直接変えるためのカルーセル（2026-11-14 ユーザー要望）の、ネットワークを使わない部分。
 *
 * - 選べる数は単位で変える：数える単位は1きざみ、g・mL は10きざみ（多ければ50きざみ）、kg・L は0.1きざみ
 * - 0 は選ばせない。0 は「在庫から消す」（2026-09-21 決定）ので、「使い切った／捨てた」から押してもらう
 *   （何日で使い切ったか・ムダ支出への返しが、そちらでしか残らないため）
 * - いまの数が刻みに乗っていなくても（0.5パックなど）、その数をそのまま選択肢に入れる
 * Node から直接テストする（stock-core.test.mjs）。そのため何も import しない。
 */

const round = (value: number) => Math.round(value * 1000) / 1000;

/** 単位ごとの刻み */
export function quantityStep(unit: string | undefined, current: number): number {
  const name = String(unit ?? "").trim();
  if (name === "g" || name === "mL") return current > 1000 ? 50 : 10;
  if (name === "kg" || name === "L") return 0.1;
  return 1;
}

/** カルーセルに並べる数（小さい順。0 は入れない） */
export function quantityChoices(current: number, unit?: string): number[] {
  const now = Number.isFinite(current) && current > 0 ? round(current) : 0;
  const step = quantityStep(unit, now);
  // 上は「いまの数の2倍」か「刻みの12個分」の大きいほう。並びすぎないよう 150 個まで
  const top = Math.max(now * 2, step * 12, now + step * 10);
  const values: number[] = [];
  for (let index = 1; values.length < 150; index++) {
    const value = round(step * index);
    if (value > top) break;
    values.push(value);
  }
  if (now > 0 && !values.includes(now)) values.push(now);
  return values.sort((a, b) => a - b);
}

/** 画面に出す数（0.1きざみの端数をきれいに） */
export function formatQuantity(value: number): string {
  return String(round(value));
}
