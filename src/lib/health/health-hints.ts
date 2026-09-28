/**
 * からだの記録（Samsung Health）を、レシピ提案の「料理の選び方」に変える部分（2026-09-28）。
 *
 * 判断の線は、**出どころのはっきりしたものだけ** を使う（2026-09-28 ユーザー要望「世界基準と一致できない？」）。
 * - 抗酸化指数：Samsung の区分（75〜100 適切／50〜74 低い／0〜49 非常に低い。本人の画面で確認）
 * - エナジースコア・睡眠スコア：Samsung の区分（85〜 非常に良い／75〜84 良い／60〜74 普通／〜59 注意が必要。同上）
 * - AGEs：Samsung が書き出しに入れている「同年代の中での位置（%）」。上位25%（75%以上）を高めとする
 * - 飲んだ水：厚生労働省「健康のため水を飲もう」の、飲み水として1日約1.2L
 * 線の分からないもの（ストレス・体水分量・歩数・血管負荷）は、これまでどおり **本人の過去の値との比較** で決める。
 * 血管負荷は Samsung の画面の5段階の境目が書き出しに無いので、本人のふだんの振れ幅の1.5倍を超えたら「高め」とする
 * （本人の9/22〜9/28の画面と突き合わせ、「やや低い」の日だけが外に出て、「順調」の日はすべて内側に入ることを確かめた）。
 * 出すのは料理の選び方の希望であって、医療的な助言ではない。AIへの指示にもそう書く。
 */
import type { DailySeries, HealthMetricKey, HealthSeries } from "./samsung-core";

/** Samsung Health の抗酸化指数の区分（本人の Samsung Health の画面で確認。2026-09-28） */
export function antioxidantLevel(value: number): "適切" | "低い" | "非常に低い" {
  return value >= 75 ? "適切" : value >= 50 ? "低い" : "非常に低い";
}

/** Samsung Health のエナジースコア・睡眠スコアの区分（同上） */
export function scoreLevel(value: number): "非常に良い" | "良い" | "普通" | "注意が必要" {
  return value >= 85 ? "非常に良い" : value >= 75 ? "良い" : value >= 60 ? "普通" : "注意が必要";
}

/** 厚生労働省「健康のため水を飲もう」：飲み水として1日あたり約1.2L */
export const DAILY_DRINKING_WATER_ML = 1200;

/** AGEs の同年代での位置がこれ以上なら「高め」（上位25%） */
export const AGES_HIGH_PERCENT = 75;

/** 血管負荷：本人のふだんの振れ幅の何倍を超えたら「高め」「低め」とするか */
export const VASCULAR_SPREAD_FACTOR = 1.5;

export type HealthHint = {
  key: "vegetables" | "gentleCooking" | "hydrating" | "quick" | "protein" | "lowSalt";
  /** 画面に出す理由（なぜこの希望を出したか） */
  reason: string;
  /** AIへ渡す希望 */
  instruction: string;
};

const DAY = 86_400_000;

/** 日本の今日の日付（YYYY-MM-DD）。サーバーは UTC で動くので、そのまま日付を取ると朝9時まで前の日になる */
export function japanDate(nowMillis: number): string {
  return new Date(nowMillis + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

function toMillis(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function daysBetween(from: string, to: string): number {
  return Math.round((toMillis(to) - toMillis(from)) / DAY);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * いちばん新しい値と、それより前の値（本人のいつもの値）を取り出す。
 * 新しい値が今日から maxAgeDays より古ければ、今の体の様子とは言えないので使わない。
 */
export function latestAgainstBaseline(daily: DailySeries | undefined, today: string, maxAgeDays: number, baselineDays: number) {
  const entries = Object.entries(daily ?? {}).filter(([date]) => date <= today).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return null;
  const [latestDate, latest] = entries[entries.length - 1];
  if (daysBetween(latestDate, today) > maxAgeDays) return null;
  const previous = entries.slice(0, -1).filter(([date]) => daysBetween(date, latestDate) <= baselineDays).map(([, value]) => value);
  return { latestDate, latest, baseline: median(previous), previousCount: previous.length };
}

/** 直近 days 日（今日を含む）の平均。記録が無ければ null */
function recentAverage(daily: DailySeries | undefined, today: string, days: number) {
  const values = Object.entries(daily ?? {}).filter(([date]) => date <= today && daysBetween(date, today) < days).map(([, v]) => v);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** その前の期間（days 日より前、baselineDays 日以内）の中央値 */
function earlierMedian(daily: DailySeries | undefined, today: string, days: number, baselineDays: number) {
  return median(Object.entries(daily ?? {})
    .filter(([date]) => date <= today && daysBetween(date, today) >= days && daysBetween(date, today) < baselineDays)
    .map(([, v]) => v));
}

function pick(series: HealthSeries, key: HealthMetricKey) {
  return series[key];
}

/**
 * 血管負荷の、いちばん新しい夜の様子。値は基準との差（大きいほど負荷が高い。samsung-core で向きをそろえてある）。
 * 本人のふだんの振れ幅（それより前30日の、基準との差の大きさの中央値）が分かるだけの夜数（7夜）が無ければ決めない。
 */
export function vascularLoadLevel(daily: DailySeries | undefined, today: string) {
  const latest = latestAgainstBaseline(daily, today, 2, 30);
  if (!latest) return null;
  const previous = Object.entries(daily ?? {})
    .filter(([date]) => date < latest.latestDate && daysBetween(date, latest.latestDate) <= 30)
    .map(([, value]) => Math.abs(value));
  const spread = median(previous);
  if (previous.length < 7 || spread === null || spread <= 0) return null;
  const edge = spread * VASCULAR_SPREAD_FACTOR;
  const level = latest.latest > edge ? "基準より高め" : latest.latest < -edge ? "基準より低め" : "基準くらい";
  return { latestDate: latest.latestDate, level } as const;
}

/**
 * 画面の「取り込んだ記録」に添える、いちばん新しい値の区分。
 * Samsung の区分があるものはその名前、血管負荷は基準との比べ方、AGEs は同年代での位置。無いものは出さない
 */
export function latestLevels(series: HealthSeries, today: string): Partial<Record<HealthMetricKey, string>> {
  const levels: Partial<Record<HealthMetricKey, string>> = {};
  const latestOf = (key: HealthMetricKey) => {
    const dates = Object.keys(series[key] ?? {}).filter((date) => date <= today).sort();
    return dates.length ? series[key]![dates[dates.length - 1]] : null;
  };
  const antioxidant = latestOf("antioxidant");
  if (antioxidant !== null) levels.antioxidant = antioxidantLevel(antioxidant);
  for (const key of ["vitality", "sleepScore"] as const) {
    const value = latestOf(key);
    if (value !== null) levels[key] = scoreLevel(value);
  }
  const agesPercent = latestOf("agesPercent");
  if (agesPercent !== null) levels.agesPercent = agesPercent >= AGES_HIGH_PERCENT ? "同年代より高め" : "同年代の中くらいまで";
  const vascular = vascularLoadLevel(series.vascularLoad, today);
  if (vascular) levels.vascularLoad = vascular.level;
  return levels;
}

/** からだの記録から、今日のレシピで気をつけたいことを出す */
export function healthHints(series: HealthSeries, today: string): HealthHint[] {
  const hints: HealthHint[] = [];

  // 抗酸化指数：野菜や果物の色素（カロテノイド）の量で上下する。Samsung の区分で「適切」でなければ、色の濃い野菜を多めに
  const antioxidant = latestAgainstBaseline(pick(series, "antioxidant"), today, 60, 180);
  if (antioxidant && antioxidantLevel(antioxidant.latest) !== "適切") {
    const change = antioxidant.baseline !== null ? `。${fmt(antioxidant.baseline)} → ${fmt(antioxidant.latest)}` : "";
    hints.push({
      key: "vegetables",
      reason: `抗酸化指数が${fmt(antioxidant.latest)}で、Samsung の区分では「${antioxidantLevel(antioxidant.latest)}」です（「適切」は75以上${change}）`,
      instruction: "色の濃い野菜（にんじん・かぼちゃ・トマト・ほうれん草・ブロッコリーなど）を在庫から多めに使う",
    });
  }

  // AGEs指数：焦げ目・揚げ物・甘い味付けで増えやすい。同年代の上位25%に入る、または前より上がっていたら、蒸す・ゆでる・煮るを優先
  const ages = latestAgainstBaseline(pick(series, "ages"), today, 60, 180);
  const agesPercent = latestAgainstBaseline(pick(series, "agesPercent"), today, 60, 180);
  const agesHighAmongPeers = agesPercent !== null && agesPercent.latest >= AGES_HIGH_PERCENT;
  const agesRising = ages && ages.baseline !== null && ages.latest > ages.baseline;
  if (agesHighAmongPeers || agesRising) {
    hints.push({
      key: "gentleCooking",
      reason: agesHighAmongPeers
        ? `AGEs指数が、同年代の中で高いほう（${fmt(agesPercent!.latest)}%の位置）です`
        : `AGEs指数がいつもより上がっています（${fmt(ages!.baseline!)} → ${fmt(ages!.latest)}）`,
      instruction: "揚げ物・強い焼き色・甘い味付けを控え、蒸す・ゆでる・煮る料理を優先する",
    });
  }

  // 水分：飲んだ水が目安（1日1.2L）かいつもより少ない、または体水分量がいつもより下がっていたら、汁物を1品
  const waterRecent = recentAverage(pick(series, "waterIntake"), today, 3);
  const waterUsual = earlierMedian(pick(series, "waterIntake"), today, 3, 30);
  const bodyWater = latestAgainstBaseline(pick(series, "bodyWater"), today, 14, 90);
  const belowGuide = waterRecent !== null && waterRecent < DAILY_DRINKING_WATER_ML;
  const lowIntake = belowGuide || (waterRecent !== null && waterUsual !== null && waterRecent < waterUsual * 0.8);
  const lowBody = bodyWater && bodyWater.baseline !== null && bodyWater.latest < bodyWater.baseline * 0.99;
  if (lowIntake || lowBody) {
    hints.push({
      key: "hydrating",
      reason: belowGuide
        ? `ここ数日の飲んだ水が1日あたり約${Math.round(waterRecent!)}mLで、厚生労働省の目安（飲み水として約1.2L）より少なめです`
        : lowIntake
          ? `ここ数日の飲んだ水がいつもより少なめです（1日あたり約${Math.round(waterRecent!)}mL）`
          : `体水分量がいつもより下がっています（${fmt(bodyWater!.baseline!)} → ${fmt(bodyWater!.latest)}kg）`,
      instruction: "汁物・スープなど水分の多い料理を1品入れる",
    });
  }

  // 血管負荷：ナトリウム（塩分）とカリウムの取り方で上下する。基準よりはっきり高い夜の翌日は、塩分控えめ・カリウム多めに
  const vascular = vascularLoadLevel(pick(series, "vascularLoad"), today);
  if (vascular?.level === "基準より高め") {
    hints.push({
      key: "lowSalt",
      reason: "血管負荷が、あなたの基準よりはっきり高めでした",
      instruction: "塩分控えめの味付けにし、野菜・いも・海藻・豆などカリウムの多い食材を在庫から使う",
    });
  }

  // 睡眠・エナジー・ストレス：Samsung の区分で「良い」に届かない日・ストレスがいつもより高い日は、手早くできるものを
  const sleep = latestAgainstBaseline(pick(series, "sleepScore") ?? pick(series, "vitalitySleep"), today, 2, 30);
  const energy = latestAgainstBaseline(pick(series, "vitality"), today, 2, 30);
  const stress = latestAgainstBaseline(pick(series, "stress"), today, 2, 30);
  const tired = sleep && sleep.latest < 75;
  const lowEnergy = energy && energy.latest < 75;
  const stressed = stress && stress.baseline !== null && stress.latest > stress.baseline * 1.2;
  if (tired || lowEnergy || stressed) {
    hints.push({
      key: "quick",
      reason: tired
        ? `睡眠スコアが${fmt(sleep!.latest)}で、Samsung の区分では「${scoreLevel(sleep!.latest)}」です（「良い」は75以上）`
        : lowEnergy
          ? `エナジースコアが${fmt(energy!.latest)}で、Samsung の区分では「${scoreLevel(energy!.latest)}」です（「良い」は75以上）`
          : "ストレスがいつもより高めです",
      instruction: "手順が少なく、15分ほどで作れる料理を優先する",
    });
  }

  // 歩数：昨日・今日よく動いていたら、たんぱく質のとれる主菜を
  const steps = latestAgainstBaseline(pick(series, "steps"), today, 1, 30);
  if (steps && steps.baseline !== null && steps.baseline > 0 && steps.latest >= steps.baseline * 1.3) {
    hints.push({
      key: "protein",
      reason: `いつもよりよく歩いています（${Math.round(steps.latest).toLocaleString("ja-JP")}歩）`,
      instruction: "肉・魚・卵・大豆など、たんぱく質のとれる主菜を入れる",
    });
  }

  return hints;
}

/** AIへの指示に足す文。希望が無ければ空 */
export function healthPromptLines(hints: HealthHint[]): string[] {
  if (!hints.length) return [];
  return [
    "",
    "【からだの記録からの希望】（医療的な指示ではなく、料理の選び方の目安。在庫と条件を守ったうえで、できる範囲で取り入れる）",
    ...hints.map((hint) => `- ${hint.instruction}`),
  ];
}
