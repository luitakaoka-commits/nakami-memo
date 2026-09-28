"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { joinHousehold, readInvite } from "@/lib/firebase/household";
import { useAuth } from "@/lib/hooks/useAuth";
import { inviteStatus } from "@/lib/household/household-core";
import { LoadingState } from "@/components/common/LoadingState";

type Invite = Awaited<ReturnType<typeof readInvite>>;

/** 招待リンクから開く画面（/app/join?code=…）。2026-09-28 */
export function JoinHousehold() {
  const code = useSearchParams().get("code") ?? "";
  const { user, household } = useAuth();
  const [invite, setInvite] = useState<Invite | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** 招待を読めなかった理由（通信や権限）。「使えない」とまとめず、写真で原因が分かるように出す */
  const [readError, setReadError] = useState("");

  useEffect(() => {
    if (!code) { setInvite(null); return; }
    readInvite(code).then(setInvite).catch((err) => {
      console.error("[招待を確かめる]", err);
      setReadError(err && typeof err === "object" && "code" in err ? String(err.code) : String(err));
      setInvite(null);
    });
  }, [code]);

  if (invite === undefined) return <LoadingState label="招待を確かめています" />;

  const status = inviteStatus(invite, Date.now());
  const head = <div className="ui-page-head"><div className="flex items-center gap-3"><Users size={25} className="text-[var(--brand)]" /><h1 className="ui-page-title">家に参加する</h1></div></div>;

  if (status !== "ok" || !invite) {
    return (
      <div className="ui-stack">
        {head}
        <p className="ui-muted">
          {!code
            ? "リンクに招待コードが入っていません。届いた招待リンクを、もう一度そのまま開いてください。"
            : readError
              ? `招待を確かめられませんでした（${readError}）。通信を確かめて、もう一度リンクを開いてください。`
              : `${status === "expired" ? "この招待リンクは期限が切れています。" : "この招待リンクは使えません。"}招待した人に、もう一度リンクを作ってもらってください。`}
        </p>
        <Link href="/app" className="ui-button ui-button--secondary">ホームへ</Link>
      </div>
    );
  }

  if (household?.id === invite.householdId) {
    return (
      <div className="ui-stack">
        {head}
        <p className="ui-muted">すでに「{household.name}」に入っています。</p>
        <Link href="/app" className="ui-button ui-button--primary">ホームへ</Link>
      </div>
    );
  }

  if (household) {
    return (
      <div className="ui-stack">
        {head}
        <p className="ui-muted">いまは「{household.name}」に入っています。別の家に入るには、先に「同居人と共有」の画面から今の家を抜けてください。</p>
        <Link href="/app/household" className="ui-button ui-button--secondary">同居人と共有へ</Link>
      </div>
    );
  }

  async function join() {
    if (!user || !invite) return;
    setError("");
    setBusy(true);
    try {
      await joinHousehold(user, code, invite.householdId);
      // 在庫の読み込み先が家に変わるので、ホームから開き直す
      window.location.replace("/app");
    } catch (err) {
      console.error("[参加]", err);
      setError("参加できませんでした。リンクの期限が切れていないか確かめて、もう一度お試しください。");
      setBusy(false);
    }
  }

  return (
    <div className="ui-stack">
      {head}
      <section className="ui-section">
        <h2 className="ui-section__title">「{invite.householdName}」に招待されています</h2>
        <p className="ui-muted">参加すると、この家の <strong>なかみメモ（在庫）</strong> と <strong>つくりおきノート（レシピ・献立・買い物リスト）</strong> を一緒に使えます。お金管理は共有されません。</p>
        <p className="ui-muted mt-2">あなたが今まで入れていたデータは消えませんが、参加しているあいだは家のデータを見るようになります。</p>
        <button type="button" onClick={join} disabled={busy} className="ui-button ui-button--primary mt-3">{busy ? "参加しています" : "参加する"}</button>
      </section>
      {error && <p role="alert" className="ui-error">{error}</p>}
    </div>
  );
}
