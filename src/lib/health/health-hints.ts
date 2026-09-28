/**
 * からだの記録（Samsung Health）を、レシピ提案の「料理の選び方」に変える部分（2026-09-28）。
 *
 * 判断は **本人の過去の値との比較だけ** で行う。抗酸化指数・AGEs指数などの「正常の範囲」を
 * このアプリは知らないので、決まった線は引かない（間違った線で「足りない」と言わないため）。
 * 出すのは料理の選び方の希望であって、医療的な助言ではない。AIへの指示にもそう書く。
 */
import type { DailySeries, HealthMetricKey, HealthSeries } from "./samsung-core";

export type HealthHint = {
  key: "vegetables" | "gentleCooking" | "hydrating" | "quick" | "protein";
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

/** からだの記録から、今日のレシピで気をつけたいことを出す（本人の過去との比較だけ） */
export function healthHints(series: HealthSeries, today: string): HealthHint[] {
  const hints: HealthHint[] = [];

  // 抗酸化指数：野菜や果物の色素の量で上下する。前より下がっていたら、色の濃い野菜を多めに
  const antioxidant = latestAgainstBaseline(pick(series, "antioxidant"), today, 60, 180);
  if (antioxidant && antioxidant.baseline !== null && antioxidant.latest < antioxidant.baseline) {
    hints.push({
      key: "vegetables",
      reason: `抗酸化指数がいつもより下がっています（${fmt(antioxidant.baseline)} → ${fmt(antioxidant.latest)}）`,
      instruction: "色の濃い野菜（にんじん・かぼちゃ・トマト・ほうれん草・ブロッコリーなど）を在庫から多めに使う",
    });
  }

  // AGEs指数：焦げ目・揚げ物・甘い味付けで増えやすい。前より上がっていたら、蒸す・ゆでる・煮るを優先
  const ages = latestAgainstBaseline(pick(series, "ages"), today, 60, 180);
  if (ages && ages.baseline !== null && ages.latest > ages.baseline) {
    hints.push({
      key: "gentleCooking",
      reason: `AGEs指数がいつもより上がっています（${fmt(ages.baseline)} → ${fmt(ages.latest)}）`,
      instruction: "揚げ物・強い焼き色・甘い味付けを控え、蒸す・ゆでる・煮る料理を優先する",
    });
  }

  // 水分：飲んだ水がいつもより少ない、または体水分量がいつもより下がっていたら、汁物を1品
  const waterRecent = recentAverage(pick(series, "waterIntake"), today, 3);
  const waterUsual = earlierMedian(pick(series, "waterIntake"), today, 3, 30);
  const bodyWater = latestAgainstBaseline(pick(series, "bodyWater"), today, 14, 90);
  const lowIntake = waterRecent !== null && waterUsual !== null && waterRecent < waterUsual * 0.8;
  const lowBody = bodyWater && bodyWater.baseline !== null && bodyWater.latest < bodyWater.baseline * 0.99;
  if (lowIntake || lowBody) {
    hints.push({
      key: "hydrating",
      reason: lowIntake
        ? `ここ数日の飲んだ水がいつもより少なめです（1日あたり約${Math.round(waterRecent!)}mL）`
        : `体水分量がいつもより下がっています（${fmt(bodyWater!.baseline!)} → ${fmt(bodyWater!.latest)}kg）`,
      instruction: "汁物・スープなど水分の多い料理を1品入れる",
    });
  }

  // 睡眠・ストレス：よく眠れていない日・ストレスが高い日は、手早くできるものを
  const sleep = latestAgainstBaseline(pick(series, "sleepScore") ?? pick(series, "vitalitySleep"), today, 2, 30);
  const stress = latestAgainstBaseline(pick(series, "stress"), today, 2, 30);
  const tired = sleep && sleep.baseline !== null && sleep.latest < sleep.baseline * 0.9;
  const stressed = stress && stress.baseline !== null && stress.latest > stress.baseline * 1.2;
  if (tired || stressed) {
    hints.push({
      key: "quick",
      reason: tired ? `睡眠スコアがいつもより低めです（${fmt(sleep!.latest)}）` : "ストレスがいつもより高めです",
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
