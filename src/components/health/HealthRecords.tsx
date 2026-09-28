"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HeartPulse, Trash2, Upload } from "lucide-react";
import { deleteAllHealth, readHealthSeries, saveHealthSeries } from "@/lib/firebase/health";
import { useAuth } from "@/lib/hooks/useAuth";
import { healthHints, japanDate } from "@/lib/health/health-hints";
import { mergeSeries, metricsForFile, readSamsungCsv, summarizeSeries, type HealthSeries } from "@/lib/health/samsung-core";

/**
 * からだの記録（2026-09-28）。Samsung Health の書き出しをブラウザの中で読み、日付と値だけを保存する。
 * ファイルそのものはどこにも送らない。健康データなので同居人とは共有しない（本人の場所に置く）。
 */
export function HealthRecords() {
  const { user } = useAuth();
  const [stored, setStored] = useState<HealthSeries | null>(null);
  const [preview, setPreview] = useState<{ series: HealthSeries; files: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    readHealthSeries(user.uid).then(setStored).catch(() => setStored({}));
  }, [user]);

  if (!user) return null;

  async function pickFiles(list: FileList | null) {
    setError("");
    setMessage("");
    const files = [...(list ?? [])].filter((file) => file.name.endsWith(".csv") && metricsForFile(file.name).length);
    if (!files.length) {
      setPreview(null);
      setError("取り込める Samsung Health のファイルが見つかりませんでした。書き出したフォルダの中の .csv ファイルを選んでください。");
      return;
    }
    const parts = await Promise.all(files.map(async (file) => readSamsungCsv(file.name, await file.text())));
    setPreview({ series: mergeSeries(...parts), files: files.length });
  }

  async function save() {
    if (!user || !preview) return;
    setBusy(true);
    setError("");
    try {
      await saveHealthSeries(user.uid, preview.series);
      setStored(await readHealthSeries(user.uid));
      setPreview(null);
      setMessage("取り込みました。次のレシピ提案から使います。");
    } catch (err) {
      console.error("[からだの記録]", err);
      setError("保存できませんでした。通信を確かめて、もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  async function removeAll() {
    if (!user) return;
    if (!window.confirm("取り込んだからだの記録を全部消します。Samsung Health の中のデータは消えません。よろしいですか？")) return;
    setBusy(true);
    try {
      await deleteAllHealth(user.uid);
      setStored({});
      setMessage("からだの記録を消しました。");
    } finally {
      setBusy(false);
    }
  }

  const summary = summarizeSeries(stored ?? {});
  const hints = healthHints(stored ?? {}, japanDate(Date.now()));

  return (
    <div className="ui-stack">
      <div className="ui-page-head">
        <div className="flex items-center gap-3"><HeartPulse size={25} className="text-[var(--brand)]" /><h1 className="ui-page-title">からだの記録</h1></div>
      </div>

      <section className="ui-section">
        <p className="ui-muted">Samsung Health から書き出したファイルを取り込むと、<Link href="/app/recipes" className="underline">レシピ提案</Link>で料理の選び方の参考にします。</p>
        <p className="ui-muted mt-2">ファイルはこの端末の中で読み、<strong>日付と数値だけ</strong>を保存します。<strong>同居人とは共有しません。</strong></p>
      </section>

      <section className="ui-section">
        <h2 className="ui-section__title">取り込む</h2>
        <ol className="ui-health-steps">
          <li>Samsung Health の設定から「個人データをダウンロード」で書き出す</li>
          <li>下のボタンで、書き出したフォルダの中の <strong>.csv ファイルをまとめて選ぶ</strong>（全部選んで大丈夫です。使うものだけ読みます）</li>
        </ol>
        <div className="flex flex-wrap gap-2 mt-3">
          <label className="ui-button ui-button--primary">
            <Upload size={16} />ファイルを選ぶ
            <input type="file" accept=".csv,text/csv" multiple hidden onChange={(event) => pickFiles(event.target.files)} />
          </label>
          <label className="ui-button ui-button--secondary">
            フォルダごと選ぶ（パソコン）
            <input type="file" multiple hidden {...({ webkitdirectory: "" } as Record<string, string>)} onChange={(event) => pickFiles(event.target.files)} />
          </label>
        </div>

        {preview && (
          <div className="mt-4">
            <p className="ui-muted">{preview.files}個のファイルから、次の記録が見つかりました。</p>
            <HealthTable rows={summarizeSeries(preview.series).filter((row) => row.count > 0)} />
            <button type="button" onClick={save} disabled={busy} className="ui-button ui-button--primary mt-3">{busy ? "保存しています" : "この内容で取り込む"}</button>
          </div>
        )}
        {message && <p className="ui-status-note mt-3">{message}</p>}
        {error && <p role="alert" className="ui-error mt-3">{error}</p>}
      </section>

      <section className="ui-section">
        <h2 className="ui-section__title">今日のレシピで気をつけること</h2>
        {hints.length ? (
          <ul className="ui-list">{hints.map((hint) => <li key={hint.key}>・{hint.instruction}<span className="ui-muted block text-xs">{hint.reason}</span></li>)}</ul>
        ) : (
          <p className="ui-muted">いまは特にありません。記録がいつもの値と比べて変わったときに、ここに出ます。</p>
        )}
      </section>

      <section className="ui-section">
        <h2 className="ui-section__title">取り込んだ記録</h2>
        {stored === null ? <p className="ui-muted">読み込んでいます…</p> : <HealthTable rows={summary} />}
        {summary.find((row) => row.key === "waterIntake")?.count === 0 && (
          <p className="ui-form-note mt-2">飲んだ水は、Samsung Health で水分を記録すると取り込めるようになります。</p>
        )}
        {stored && summary.some((row) => row.count > 0) && (
          <button type="button" onClick={removeAll} disabled={busy} className="ui-button ui-button--ghost mt-3"><Trash2 size={15} />からだの記録を全部消す</button>
        )}
      </section>
    </div>
  );
}

function HealthTable({ rows }: { rows: ReturnType<typeof summarizeSeries> }) {
  return (
    <ul className="ui-health-table">
      {rows.map((row) => (
        <li key={row.key}>
          <span>{row.label}</span>
          {row.count ? (
            <span className="ui-health-table__value">
              <strong>{typeof row.latest === "number" ? row.latest.toLocaleString("ja-JP") : row.latest}{row.unit}</strong>
              <small className="ui-muted">{row.to.slice(5).replace("-", "/")}・{row.count}日分</small>
            </span>
          ) : (
            <span className="ui-muted">記録なし</span>
          )}
        </li>
      ))}
    </ul>
  );
}
