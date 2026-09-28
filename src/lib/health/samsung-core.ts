/**
 * Samsung Health の書き出し（個人データのダウンロード）を読む部分。ネットワークを使わない（2026-09-28）。
 *
 * Samsung Health にはWebアプリから直接読む公開の方法が無いので、本人が書き出したCSVをブラウザの中で読み、
 * **日付と値だけ** を本人の場所（users/{uid}/health）に保存する。ファイルそのものはどこにも送らない。
 * 健康データなので、同居人と共有する「家」には入れない。
 *
 * CSVの形（2026-09-28 の書き出しで確認。値は見ていない）
 *   1行目: データの種類と版（例「com.samsung.health.antioxidant,7006011,2」）
 *   2行目: 列の見出し
 *   3行目から: データ。日時は「2026-09-28 03:12:00.000」（UTC）、時差は別の列「UTC+0900」
 *   day_time の列は、その日の日付（時刻は 00:00）
 *   値が空の行がある。コメントなどの列に「,」を含む値が引用符つきで入ることがある
 */

export type HealthMetricKey =
  | "antioxidant" | "ages" | "bodyWater" | "weight" | "waterIntake"
  | "vitality" | "vitalitySleep" | "vitalityActivity" | "sleepScore" | "stress" | "steps" | "heartHealth";

type Aggregate = "last" | "sum" | "max" | "avg";

export type HealthMetricDef = {
  key: HealthMetricKey;
  label: string;
  unit: string;
  /** ファイル名がこれで始まる（com.samsung. の後ろ）。「.raw」などの別ファイルに当たらないよう、後ろに「.」と日付が続く */
  file: string;
  /** 値の列（どれか最初に見つかったもの） */
  valueColumns: string[];
  /** 日時の列。day_time ならその日の日付、start_time なら時差を足して日本の日付にする */
  timeColumns: string[];
  /** 1日に何件もあるときのまとめ方 */
  aggregate: Aggregate;
  /** 数字が大きいほど良いか（レシピ提案の判断に使う。null は向きを決めない） */
  higherIsBetter: boolean | null;
};

/**
 * 取り込む項目。飲んだ水（waterIntake）は 2026-09-28 の書き出しに無かった（Samsung Health で水を記録していない）。
 * 記録すると「com.samsung.health.water_intake」が出る見込みだが、実物では確かめていない。
 * 列の名前が違っても拾えるよう、値の列を複数並べてある。
 */
export const HEALTH_METRICS: HealthMetricDef[] = [
  { key: "antioxidant", label: "抗酸化指数", unit: "", file: "health.antioxidant", valueColumns: ["antioxidant"], timeColumns: ["start_time"], aggregate: "last", higherIsBetter: true },
  { key: "ages", label: "AGEs指数", unit: "", file: "health.advanced_glycation_endproduct", valueColumns: ["score"], timeColumns: ["day_time", "start_time"], aggregate: "last", higherIsBetter: false },
  { key: "bodyWater", label: "体水分量", unit: "kg", file: "health.weight", valueColumns: ["total_body_water"], timeColumns: ["start_time"], aggregate: "last", higherIsBetter: null },
  { key: "weight", label: "体重", unit: "kg", file: "health.weight", valueColumns: ["weight"], timeColumns: ["start_time"], aggregate: "last", higherIsBetter: null },
  { key: "waterIntake", label: "飲んだ水", unit: "mL", file: "health.water_intake", valueColumns: ["amount", "com.samsung.health.water_intake.amount", "volume"], timeColumns: ["start_time", "com.samsung.health.water_intake.start_time"], aggregate: "sum", higherIsBetter: true },
  { key: "vitality", label: "元気スコア", unit: "", file: "shealth.vitality_score", valueColumns: ["total_score"], timeColumns: ["day_time"], aggregate: "last", higherIsBetter: true },
  { key: "vitalitySleep", label: "元気スコア（睡眠）", unit: "", file: "shealth.vitality_score", valueColumns: ["sleep_score"], timeColumns: ["day_time"], aggregate: "last", higherIsBetter: true },
  { key: "vitalityActivity", label: "元気スコア（活動）", unit: "", file: "shealth.vitality_score", valueColumns: ["activity_score"], timeColumns: ["day_time"], aggregate: "last", higherIsBetter: true },
  { key: "sleepScore", label: "睡眠スコア", unit: "", file: "shealth.sleep", valueColumns: ["sleep_score"], timeColumns: ["com.samsung.health.sleep.end_time", "com.samsung.health.sleep.start_time", "start_time"], aggregate: "last", higherIsBetter: true },
  { key: "stress", label: "ストレス", unit: "", file: "shealth.stress", valueColumns: ["score"], timeColumns: ["start_time"], aggregate: "avg", higherIsBetter: false },
  { key: "steps", label: "歩数", unit: "歩", file: "shealth.tracker.pedometer_day_summary", valueColumns: ["step_count"], timeColumns: ["day_time"], aggregate: "max", higherIsBetter: true },
  { key: "heartHealth", label: "心臓の健康スコア", unit: "", file: "shealth.heart_health_score", valueColumns: ["total_score"], timeColumns: ["day_time"], aggregate: "last", higherIsBetter: true },
];

/** 日付 → 値。日付は日本の「YYYY-MM-DD」 */
export type DailySeries = Record<string, number>;
export type HealthSeries = Partial<Record<HealthMetricKey, DailySeries>>;

/** 引用符・引用符の中の「,」「改行」に対応したCSVの読み取り */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** 「UTC+0900」→ 分（540）。読めなければ日本時間（540）とみなす */
export function offsetMinutes(offset: string | undefined): number {
  const m = /UTC([+-])(\d{2}):?(\d{2})/.exec(String(offset ?? ""));
  if (!m) return 540;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutes : minutes;
}

/**
 * 日時の列を日本（その人の地域）の日付にする。
 * day_time はもともと「その日」を表すので、日付の部分をそのまま使う。
 * start_time などは UTC なので、時差を足してから日付を取る（夜中の測定が前の日にずれないように）。
 */
export function localDateOf(value: string | undefined, column: string, offset: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!m) return null;
  if (column.endsWith("day_time")) return `${m[1]}-${m[2]}-${m[3]}`;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  const local = new Date(utc + offsetMinutes(offset) * 60_000);
  return local.toISOString().slice(0, 10);
}

/** ファイル名から、どの項目のファイルかを決める（1つのファイルが複数の項目を持つことがある：体重と体水分量など） */
export function metricsForFile(fileName: string): HealthMetricDef[] {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/^com\.samsung\./, "");
  return HEALTH_METRICS.filter((def) => new RegExp(`^${def.file.replace(/\./g, "\\.")}\\.\\d{8,}`).test(base));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 1つのファイルの中身を、項目ごとの日ごとの値にする。値が空・数でない行は飛ばす */
export function readSamsungCsv(fileName: string, text: string): HealthSeries {
  const defs = metricsForFile(fileName);
  if (!defs.length) return {};
  const rows = parseCsv(text);
  if (rows.length < 3) return {};
  const header = rows[1].map((name) => name.trim());
  const offsetIndex = header.findIndex((name) => name === "time_offset" || name.endsWith(".time_offset"));
  const result: HealthSeries = {};

  for (const def of defs) {
    const valueIndex = def.valueColumns.map((name) => header.indexOf(name)).find((index) => index >= 0) ?? -1;
    const timeColumn = def.timeColumns.find((name) => header.includes(name));
    if (valueIndex < 0 || !timeColumn) continue;
    const timeIndex = header.indexOf(timeColumn);
    const buckets = new Map<string, number[]>();
    for (const row of rows.slice(2)) {
      const raw = (row[valueIndex] ?? "").trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      const date = localDateOf(row[timeIndex], timeColumn, offsetIndex >= 0 ? row[offsetIndex] : undefined);
      if (!date) continue;
      buckets.set(date, [...(buckets.get(date) ?? []), value]);
    }
    const series: DailySeries = {};
    buckets.forEach((values, date) => {
      const pick = def.aggregate === "sum" ? values.reduce((a, b) => a + b, 0)
        : def.aggregate === "max" ? Math.max(...values)
        : def.aggregate === "avg" ? values.reduce((a, b) => a + b, 0) / values.length
        : values[values.length - 1];
      series[date] = round(pick);
    });
    if (Object.keys(series).length) result[def.key] = series;
  }
  return result;
}

/** 複数ファイルの結果を合わせる（同じ日は後から読んだものを使う） */
export function mergeSeries(...parts: HealthSeries[]): HealthSeries {
  const merged: HealthSeries = {};
  for (const part of parts) {
    for (const [key, series] of Object.entries(part) as Array<[HealthMetricKey, DailySeries]>) {
      merged[key] = { ...(merged[key] ?? {}), ...series };
    }
  }
  return merged;
}

/** 保存の単位（月ごとに1件）。{ "antioxidant_2026-09": { metric, month, values } } */
export function monthlyDocs(series: HealthSeries): Array<{ id: string; metric: HealthMetricKey; month: string; values: DailySeries }> {
  const docs = new Map<string, { id: string; metric: HealthMetricKey; month: string; values: DailySeries }>();
  for (const [metric, daily] of Object.entries(series) as Array<[HealthMetricKey, DailySeries]>) {
    for (const [date, value] of Object.entries(daily)) {
      const month = date.slice(0, 7);
      const id = `${metric}_${month}`;
      const entry = docs.get(id) ?? { id, metric, month, values: {} };
      entry.values[date] = value;
      docs.set(id, entry);
    }
  }
  return [...docs.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** 保存してある月ごとの記録（monthlyDocs の形）から、項目ごとの日ごとの値に戻す。知らない項目・壊れた値は捨てる */
export function seriesFromDocs(docs: ReadonlyArray<Record<string, unknown>>): HealthSeries {
  const known = new Set<string>(HEALTH_METRICS.map((def) => def.key));
  const series: HealthSeries = {};
  for (const entry of docs || []) {
    const metric = String(entry?.metric ?? "");
    if (!known.has(metric) || !entry.values || typeof entry.values !== "object") continue;
    const daily: DailySeries = { ...(series[metric as HealthMetricKey] ?? {}) };
    for (const [date, value] of Object.entries(entry.values as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Number(value))) daily[date] = Number(value);
    }
    series[metric as HealthMetricKey] = daily;
  }
  return series;
}

/** 画面に出すまとめ（項目ごとの件数・期間・いちばん新しい値） */
export function summarizeSeries(series: HealthSeries) {
  return HEALTH_METRICS.map((def) => {
    const daily = series[def.key] ?? {};
    const dates = Object.keys(daily).sort();
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      count: dates.length,
      from: dates[0] ?? "",
      to: dates[dates.length - 1] ?? "",
      latest: dates.length ? daily[dates[dates.length - 1]] : null,
    };
  });
}
