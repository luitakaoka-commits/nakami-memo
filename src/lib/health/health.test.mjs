/* からだの記録（Samsung Health の取り込みと、レシピ提案への生かし方）の確認（2026-09-28）。
 * 実行: node --experimental-strip-types src/lib/health/health.test.mjs（npm test から呼ばれる）
 *
 * データはすべて作り物。列の名前と日時の書き方だけ、2026-09-28 の本物の書き出しに合わせてある（値は見ていない）。
 */
import {
  HEALTH_METRICS, localDateOf, mergeSeries, metricsForFile, monthlyDocs, offsetMinutes, parseCsv, readSamsungCsv,
  seriesFromDocs, summarizeSeries,
} from "./samsung-core.ts";
import {
  antioxidantLevel, healthHints, healthPromptLines, japanDate, latestAgainstBaseline, latestLevels, scoreLevel, vascularLoadLevel,
} from "./health-hints.ts";
import { buildPrompt, normalizeOptions } from "../recipes/suggest-core.ts";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("OK   " + name); }
  catch (e) { fail++; console.log("失敗 " + name + "  →  " + (e.message || e)); }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: 期待 ${b} / 実際 ${a}`);
}
function ok(cond, label) { if (!cond) throw new Error(label); }

/** 本物と同じ形のCSV（1行目は種類と版、2行目は見出し、末尾に「,」が付く） */
function csv(kind, header, rows) {
  return `\uFEFF${kind},7006011,2\r\n${header.join(",")},\r\n${rows.map((row) => header.map((h) => row[h] ?? "").join(",") + ",").join("\r\n")}\r\n`;
}
const ANTIOXIDANT_HEADER = ["create_sh_ver", "start_time", "modify_sh_ver", "update_time", "create_time", "antioxidant", "time_offset", "deviceuuid", "pkg_name", "datauuid"];
const WEIGHT_HEADER = ["body_fat_mass", "create_sh_ver", "start_time", "custom", "height", "weight", "muscle_mass", "time_offset", "comment", "total_body_water"];
const STRESS_HEADER = ["create_sh_ver", "start_time", "custom", "score", "time_offset", "comment"];
const STEPS_HEADER = ["create_sh_ver", "step_count", "source_package_name", "day_time"];

/* ---------- 読み取り ---------- */

t("CSVの読み取り：先頭の印（BOM）、改行 CRLF、引用符の中の「,」に対応する", () => {
  eq(parseCsv('\uFEFFa,b\r\n1,"x, y"\r\n'), [["a", "b"], ["1", "x, y"]], "引用符");
  eq(parseCsv('a\n"say ""hi"""\n'), [["a"], ['say "hi"']], "引用符の中の引用符");
});

t("時差の読み取り（読めなければ日本時間）", () => {
  eq(offsetMinutes("UTC+0900"), 540, "日本");
  eq(offsetMinutes("UTC-0500"), -300, "マイナス");
  eq(offsetMinutes(""), 540, "空");
});

t("日付：start_time は時差を足して日本の日付に、day_time はそのまま", () => {
  eq(localDateOf("2026-09-27 16:30:00.000", "start_time", "UTC+0900"), "2026-09-28", "UTCの夕方は日本の翌日");
  eq(localDateOf("2026-09-27 10:00:00.000", "start_time", "UTC+0900"), "2026-09-27", "同じ日");
  eq(localDateOf("2026-09-27 00:00:00.000", "day_time", "UTC+0900"), "2026-09-27", "day_time は時差を足さない");
  eq(localDateOf("", "start_time", "UTC+0900"), null, "空");
});

t("ファイル名から項目を決める（.raw や別の種類のファイルには当たらない）", () => {
  const keys = (name) => metricsForFile(name).map((def) => def.key);
  eq(keys("com.samsung.health.antioxidant.20260928123868.csv"), ["antioxidant"], "抗酸化指数");
  // 2026-09-28：同じファイルから「同年代での位置（percent）」も読むようにした（体組成と同じく1ファイル2項目）
  eq(keys("com.samsung.health.advanced_glycation_endproduct.20260928123868.csv"), ["ages", "agesPercent"], "AGEs");
  eq(keys("com.samsung.shealth.mean_arterial_pressure.20260928123868.csv"), ["vascularLoad"], "血管負荷");
  eq(keys("com.samsung.health.advanced_glycation_endproduct.raw.20260928123868.csv"), [], ".raw は読まない");
  eq(keys("com.samsung.health.weight.20260928123868.csv"), ["bodyWater", "weight"], "体組成は2項目");
  eq(keys("com.samsung.shealth.sleep.20260928123868.csv"), ["sleepScore"], "睡眠");
  eq(keys("com.samsung.shealth.sleep_combined.20260928123868.csv"), [], "sleep_combined は別物");
  eq(keys("C:\\Downloads\\x\\com.samsung.shealth.vitality_score.20260928123868.csv"), ["vitality", "vitalitySleep", "vitalityActivity"], "フォルダ付きの名前");
  eq(keys("com.samsung.shealth.badge.20260928123868.csv"), [], "使わないファイル");
});

t("抗酸化指数を読む：空の値は飛ばし、同じ日は最後の値", () => {
  const text = csv("com.samsung.health.antioxidant", ANTIOXIDANT_HEADER, [
    { start_time: "2026-09-01 01:00:00.000", antioxidant: "40", time_offset: "UTC+0900" },
    { start_time: "2026-09-01 05:00:00.000", antioxidant: "42", time_offset: "UTC+0900" },
    { start_time: "2026-09-10 01:00:00.000", antioxidant: "", time_offset: "UTC+0900" },
    { start_time: "2026-09-20 16:00:00.000", antioxidant: "38", time_offset: "UTC+0900" },
  ]);
  eq(readSamsungCsv("com.samsung.health.antioxidant.20260928123868.csv", text), { antioxidant: { "2026-09-01": 42, "2026-09-21": 38 } }, "日ごとの値");
});

t("体組成のファイルから、体水分量と体重の両方を取る", () => {
  const text = csv("com.samsung.health.weight", WEIGHT_HEADER, [
    { start_time: "2026-09-05 00:00:00.000", weight: "60.5", total_body_water: "33.123456", time_offset: "UTC+0900", comment: '"朝, 起きてすぐ"' },
  ]);
  eq(readSamsungCsv("com.samsung.health.weight.20260928123868.csv", text), { bodyWater: { "2026-09-05": 33.12 }, weight: { "2026-09-05": 60.5 } }, "2項目（コメントの「,」で列がずれない）");
});

t("1日に何件もある項目：ストレスは平均、歩数は最大（端末が2つあっても二重に数えない）", () => {
  const stress = csv("com.samsung.shealth.stress", STRESS_HEADER, [
    { start_time: "2026-09-05 00:00:00.000", score: "30", time_offset: "UTC+0900" },
    { start_time: "2026-09-05 03:00:00.000", score: "50", time_offset: "UTC+0900" },
  ]);
  eq(readSamsungCsv("com.samsung.shealth.stress.20260928123868.csv", stress).stress, { "2026-09-05": 40 }, "平均");
  const steps = csv("com.samsung.shealth.tracker.pedometer_day_summary", STEPS_HEADER, [
    { day_time: "2026-09-05 00:00:00.000", step_count: "6000", source_package_name: "phone" },
    { day_time: "2026-09-05 00:00:00.000", step_count: "8000", source_package_name: "watch" },
  ]);
  eq(readSamsungCsv("com.samsung.shealth.tracker.pedometer_day_summary.20260928123868.csv", steps).steps, { "2026-09-05": 8000 }, "最大");
});

t("飲んだ水：記録すれば取り込める（1日の合計）", () => {
  const text = csv("com.samsung.health.water_intake", ["start_time", "amount", "time_offset"], [
    { start_time: "2026-09-05 00:00:00.000", amount: "200", time_offset: "UTC+0900" },
    { start_time: "2026-09-05 05:00:00.000", amount: "300", time_offset: "UTC+0900" },
  ]);
  eq(readSamsungCsv("com.samsung.health.water_intake.20260928123868.csv", text), { waterIntake: { "2026-09-05": 500 } }, "合計");
});

t("AGEs：指数と、同年代の中での位置（%）を読む", () => {
  const header = ["create_sh_ver", "measurement_result", "percent", "modify_sh_ver", "update_time", "create_time", "score", "deviceuuid", "level_boundary", "pkg_name", "datauuid", "day_time"];
  const text = csv("com.samsung.health.advanced_glycation_endproduct", header, [
    { day_time: "2026-09-20 00:00:00.000", score: "110", percent: "40", measurement_result: "0", level_boundary: "x.level_boundary.json" },
  ]);
  eq(readSamsungCsv("com.samsung.health.advanced_glycation_endproduct.20260928123868.csv", text), { ages: { "2026-09-20": 110 }, agesPercent: { "2026-09-20": 40 } }, "2項目");
});

t("血管負荷：毎晩の結果（type 3）だけを、画面と同じ向き（大きいほど負荷が高い）・測り終えた朝の日付で読む", () => {
  const header = ["create_sh_ver", "measurement", "start_time", "modify_sh_ver", "update_time", "create_time", "type", "time_offset", "deviceuuid", "pkg_name", "end_time", "datauuid"];
  const text = csv("com.samsung.shealth.mean_arterial_pressure", header, [
    { type: "1", measurement: "", start_time: "2026-09-05 13:33:00.000", end_time: "2026-09-05 22:00:00.000", time_offset: "UTC+0900" },
    { type: "2", measurement: "85.5", start_time: "2026-09-08 15:18:00.000", end_time: "2026-09-08 22:00:00.000", time_offset: "UTC+0900" },
    { type: "3", measurement: "1.5", start_time: "2026-09-26 11:30:00.000", end_time: "2026-09-27 00:50:00.000", time_offset: "UTC+0900" },
    { type: "3", measurement: "-2.25", start_time: "2026-09-27 18:18:00.000", end_time: "2026-09-28 03:30:00.000", time_offset: "UTC+0900" },
    { type: "3", measurement: "", start_time: "2026-09-22 19:11:00.000", end_time: "2026-09-23 01:00:00.000", time_offset: "UTC+0900" },
  ]);
  eq(readSamsungCsv("com.samsung.shealth.mean_arterial_pressure.20260928123868.csv", text), { vascularLoad: { "2026-09-27": -1.5, "2026-09-28": 2.25 } }, "type 3 だけ・向きを逆に・朝の日付");
});

t("保存の形（月ごとに1件）と、読み戻し", () => {
  const series = mergeSeries({ antioxidant: { "2026-08-31": 40, "2026-09-01": 42 } }, { antioxidant: { "2026-09-01": 43 }, steps: { "2026-09-02": 9000 } });
  eq(series.antioxidant, { "2026-08-31": 40, "2026-09-01": 43 }, "後から読んだほうを使う");
  const docs = monthlyDocs(series);
  eq(docs.map((d) => d.id), ["antioxidant_2026-08", "antioxidant_2026-09", "steps_2026-09"], "月ごと");
  eq(seriesFromDocs(docs), series, "読み戻すと同じ");
  eq(seriesFromDocs([{ metric: "unknown", values: { "2026-09-01": 1 } }, { metric: "steps", values: { bad: 1, "2026-09-03": "x" } }]), { steps: {} }, "知らない項目・壊れた値は捨てる");
});

t("まとめ：項目ごとの件数・期間・いちばん新しい値", () => {
  const rows = summarizeSeries({ antioxidant: { "2026-09-01": 42, "2026-09-20": 38 } });
  eq(rows.length, HEALTH_METRICS.length, "全項目を並べる");
  eq(rows.find((row) => row.key === "antioxidant"), { key: "antioxidant", label: "抗酸化指数", unit: "", count: 2, from: "2026-09-01", to: "2026-09-20", latest: 38 }, "抗酸化指数");
  eq(rows.find((row) => row.key === "waterIntake").count, 0, "記録なし");
});

/* ---------- レシピ提案への生かし方（Samsung・厚生労働省の区分と、本人の過去の値との比較） ---------- */

const TODAY = "2026-09-28";

t("日本の今日の日付（サーバーは UTC）", () => {
  eq(japanDate(Date.parse("2026-09-27T20:00:00Z")), "2026-09-28", "UTC の夜は日本の翌日");
});

t("いちばん新しい値と、本人のいつもの値（それより前の中央値）", () => {
  eq(latestAgainstBaseline({ "2026-09-01": 40, "2026-09-10": 44, "2026-09-20": 38 }, TODAY, 60, 180), { latestDate: "2026-09-20", latest: 38, baseline: 42, previousCount: 2 }, "中央値");
  eq(latestAgainstBaseline({ "2026-06-01": 40 }, TODAY, 60, 180), null, "古すぎる記録は使わない");
  eq(latestAgainstBaseline({}, TODAY, 60, 180), null, "記録なし");
});

t("抗酸化指数が前より下がっていたら、色の濃い野菜を多めに", () => {
  const hints = healthHints({ antioxidant: { "2026-09-01": 42, "2026-09-20": 36 } }, TODAY);
  eq(hints.map((h) => h.key), ["vegetables"], "野菜");
  ok(hints[0].reason.includes("42 → 36"), `理由に数値: ${hints[0].reason}`);
});

// 2026-09-28 仕様変更：「決まった線は引かない」をやめ、Samsung の区分（75以上が適切）で決める（ユーザー要望「世界基準と一致できない？」）。
// 前の版のこのテストは「上がった（36→42）」「1回だけ（20）」なら何も言わない、だった。どちらも Samsung の区分では「非常に低い」なので言う側に変わる
t("抗酸化指数は Samsung の区分で決める：適切（75以上）なら言わない。低ければ上がっていても・1回だけでも言う。古い記録は使わない", () => {
  eq(healthHints({ antioxidant: { "2026-09-01": 90, "2026-09-20": 80 } }, TODAY), [], "下がっても適切なら言わない");
  eq(healthHints({ antioxidant: { "2026-09-20": 75 } }, TODAY), [], "75ちょうどは適切");
  eq(healthHints({ antioxidant: { "2026-09-01": 36, "2026-09-20": 42 } }, TODAY).map((h) => h.key), ["vegetables"], "上がっても非常に低い");
  const once = healthHints({ antioxidant: { "2026-09-20": 74 } }, TODAY);
  eq(once.map((h) => h.key), ["vegetables"], "1回だけでも低い");
  ok(once[0].reason.includes("「低い」") && once[0].reason.includes("75以上"), `理由に区分: ${once[0].reason}`);
  eq(healthHints({ antioxidant: { "2026-05-01": 42, "2026-06-01": 20 } }, TODAY), [], "古い");
});

t("Samsung の区分の境目（本人の画面で確認）", () => {
  eq([100, 75, 74, 50, 49, 0].map(antioxidantLevel), ["適切", "適切", "低い", "低い", "非常に低い", "非常に低い"], "抗酸化指数");
  eq([100, 85, 84, 75, 74, 60, 59].map(scoreLevel), ["非常に良い", "非常に良い", "良い", "良い", "普通", "普通", "注意が必要"], "エナジー・睡眠");
});

t("AGEs指数が前より上がっていたら、蒸す・ゆでる・煮るを優先", () => {
  eq(healthHints({ ages: { "2026-09-01": 100, "2026-09-25": 120 } }, TODAY).map((h) => h.key), ["gentleCooking"], "上がった");
  eq(healthHints({ ages: { "2026-09-01": 120, "2026-09-25": 100 } }, TODAY), [], "下がった");
});

t("飲んだ水がいつもより少ない、または体水分量が下がったら、汁物を1品", () => {
  const water = { "2026-09-10": 1500, "2026-09-15": 1500, "2026-09-20": 1500, "2026-09-27": 800, "2026-09-28": 900 };
  eq(healthHints({ waterIntake: water }, TODAY).map((h) => h.key), ["hydrating"], "飲んだ水");
  eq(healthHints({ bodyWater: { "2026-09-01": 34, "2026-09-25": 33 } }, TODAY).map((h) => h.key), ["hydrating"], "体水分量");
  eq(healthHints({ bodyWater: { "2026-09-01": 34, "2026-09-25": 33.9 } }, TODAY), [], "わずかな差は言わない");
});

t("よく眠れなかった日・ストレスが高い日は、手早くできる料理を", () => {
  const usual = { "2026-09-20": 80, "2026-09-21": 82, "2026-09-22": 78 };
  eq(healthHints({ sleepScore: { ...usual, "2026-09-28": 60 } }, TODAY).map((h) => h.key), ["quick"], "睡眠");
  eq(healthHints({ vitalitySleep: { ...usual, "2026-09-28": 60 } }, TODAY).map((h) => h.key), ["quick"], "睡眠スコアが無ければ元気スコアの睡眠");
  eq(healthHints({ stress: { "2026-09-20": 30, "2026-09-21": 30, "2026-09-28": 45 } }, TODAY).map((h) => h.key), ["quick"], "ストレス");
  eq(healthHints({ sleepScore: { ...usual, "2026-09-25": 60 } }, TODAY), [], "3日前の睡眠は今日には効かない");
});

t("睡眠・エナジースコアは Samsung の区分で決める（「良い」の75以上なら、いつもより低くても言わない）", () => {
  const usual = { "2026-09-20": 95, "2026-09-21": 96, "2026-09-22": 94 };
  eq(healthHints({ sleepScore: { ...usual, "2026-09-28": 76 } }, TODAY), [], "いつもより低いが「良い」");
  const low = healthHints({ sleepScore: { "2026-09-28": 74 } }, TODAY);
  eq(low.map((h) => h.key), ["quick"], "1回だけでも「普通」なら");
  ok(low[0].reason.includes("「普通」"), `理由に区分: ${low[0].reason}`);
  const energy = healthHints({ vitality: { "2026-09-27": 58 } }, TODAY);
  eq(energy.map((h) => h.key), ["quick"], "エナジースコアが「注意が必要」");
  ok(energy[0].reason.includes("エナジースコア") && energy[0].reason.includes("「注意が必要」"), `理由: ${energy[0].reason}`);
  eq(healthHints({ vitality: { "2026-09-28": 80 } }, TODAY), [], "エナジースコアが「良い」");
});

t("飲んだ水が厚生労働省の目安（飲み水として1日約1.2L）より少なければ、いつもの値が無くても汁物を", () => {
  const hints = healthHints({ waterIntake: { "2026-09-27": 1000, "2026-09-28": 900 } }, TODAY);
  eq(hints.map((h) => h.key), ["hydrating"], "目安より少ない");
  ok(hints[0].reason.includes("厚生労働省"), `理由に出どころ: ${hints[0].reason}`);
  eq(healthHints({ waterIntake: { "2026-09-27": 1300, "2026-09-28": 1250 } }, TODAY), [], "目安どおり");
});

t("AGEs が同年代の上位25%（75%以上の位置）なら、蒸す・ゆでる・煮るを優先", () => {
  const hints = healthHints({ agesPercent: { "2026-09-25": 80 } }, TODAY);
  eq(hints.map((h) => h.key), ["gentleCooking"], "高め");
  ok(hints[0].reason.includes("同年代"), `理由: ${hints[0].reason}`);
  eq(healthHints({ agesPercent: { "2026-09-25": 74 } }, TODAY), [], "中くらい");
});

t("血管負荷：本人のふだんの振れ幅の1.5倍より高い夜の翌日は、塩分控えめ・カリウム多めに", () => {
  // ふだんは基準との差が ±1 くらい（振れ幅の中央値 1 → 境目 1.5）
  const usual = { "2026-09-18": 1, "2026-09-19": -1, "2026-09-20": 0.8, "2026-09-21": -1.2, "2026-09-22": 1, "2026-09-23": -0.9, "2026-09-24": 1.1 };
  const high = healthHints({ vascularLoad: { ...usual, "2026-09-28": 1.6 } }, TODAY);
  eq(high.map((h) => h.key), ["lowSalt"], "高め");
  ok(high[0].instruction.includes("塩分控えめ") && high[0].instruction.includes("カリウム"), `中身: ${high[0].instruction}`);
  eq(healthHints({ vascularLoad: { ...usual, "2026-09-28": 1.4 } }, TODAY), [], "基準くらい");
  eq(healthHints({ vascularLoad: { ...usual, "2026-09-28": -3 } }, TODAY), [], "低めは言わない");
  eq(vascularLoadLevel({ ...usual, "2026-09-28": -3 }, TODAY)?.level, "基準より低め", "低め");
  eq(healthHints({ vascularLoad: { ...usual, "2026-09-25": 3 } }, TODAY), [], "3日前の夜は今日には効かない");
  const few = { "2026-09-22": 1, "2026-09-23": -1, "2026-09-24": 1, "2026-09-28": 5 };
  eq(vascularLoadLevel(few, TODAY), null, "7夜そろうまでは決めない");
});

t("取り込んだ記録に添える区分", () => {
  const usual = { "2026-09-18": 1, "2026-09-19": -1, "2026-09-20": 0.8, "2026-09-21": -1.2, "2026-09-22": 1, "2026-09-23": -0.9, "2026-09-24": 1.1 };
  eq(latestLevels({
    antioxidant: { "2026-09-20": 60 },
    vitality: { "2026-09-28": 86 },
    sleepScore: { "2026-09-28": 70 },
    agesPercent: { "2026-09-25": 40 },
    vascularLoad: { ...usual, "2026-09-28": 0.2 },
    steps: { "2026-09-28": 9000 },
  }, TODAY), { antioxidant: "低い", vitality: "非常に良い", sleepScore: "普通", agesPercent: "同年代の中くらいまで", vascularLoad: "基準くらい" }, "区分のあるものだけ");
});

t("よく歩いた日は、たんぱく質のとれる主菜を", () => {
  eq(healthHints({ steps: { "2026-09-20": 6000, "2026-09-21": 6000, "2026-09-27": 12000 } }, TODAY).map((h) => h.key), ["protein"], "昨日よく歩いた");
  eq(healthHints({ steps: { "2026-09-20": 6000, "2026-09-27": 6500 } }, TODAY), [], "いつもどおり");
});

t("記録が無ければ何も言わない", () => {
  eq(healthHints({}, TODAY), [], "空");
});

t("AIへの指示：医療的な指示ではない、在庫と条件のほうが優先、と伝える", () => {
  eq(healthPromptLines([]), [], "希望なしなら何も足さない");
  const lines = healthPromptLines(healthHints({ antioxidant: { "2026-09-01": 42, "2026-09-20": 36 } }, TODAY)).join("\n");
  ok(lines.includes("医療的な指示ではなく"), "医療ではないと伝える");
  ok(lines.includes("在庫と条件を守ったうえで"), "在庫と条件が優先");
  ok(lines.includes("色の濃い野菜"), "希望の中身");
});

t("レシピ提案の指示に、からだの記録の希望が入る（生かさない設定なら入らない）", () => {
  const pantry = [{ id: "c", name: "にんじん", quantity: 2, unit: "本", category: "食品", expiresInDays: 5 }];
  const options = normalizeOptions({}, pantry);
  eq(options.useHealth, true, "既定は生かす");
  eq(normalizeOptions({ useHealth: false }, pantry).useHealth, false, "生かさない");
  const lines = healthPromptLines(healthHints({ antioxidant: { "2026-09-01": 42, "2026-09-20": 36 } }, TODAY));
  ok(buildPrompt(pantry, [], options, lines).includes("【からだの記録からの希望】"), "入る");
  ok(!buildPrompt(pantry, [], options).includes("【からだの記録からの希望】"), "渡さなければ入らない");
});

console.log(`\n合計 ${pass + fail} 件 ／ 成功 ${pass} ／ 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
