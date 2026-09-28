"use client";

import { useState } from "react";
import { Check, Copy, Share2, Users } from "lucide-react";
import { createHouseholdFromPersonal, createInvite, leaveHousehold, removeMember } from "@/lib/firebase/household";
import { useAuth } from "@/lib/hooks/useAuth";
import { inviteLink, INVITE_DAYS } from "@/lib/household/household-core";

/**
 * 同居人との共有の設定（2026-09-28）。
 * 共有するのは、なかみメモとつくりおきノートだけ。お金管理は共有しない（ユーザーの希望）。
 * 家を作る・入る・抜けると、読み書きする場所が変わるので、終わったら画面を読み込み直す。
 */
export function HouseholdSettings() {
  const { user, household, refreshHousehold } = useAuth();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

  if (!user) return null;
  const isOwner = household?.ownerUid === user.uid;

  async function run(task: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await task();
    } catch (err) {
      console.error("[共有]", err);
      setError(err instanceof Error ? err.message : "うまくいきませんでした。");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function create() {
    if (!user) return;
    if (!window.confirm("家を作って、なかみメモとつくりおきノートのデータを家に写します。お金管理は写しません。よろしいですか？")) return;
    await run(async () => {
      await createHouseholdFromPersonal(user, setProgress);
      await refreshHousehold();
      // 在庫の読み込み先が変わるので、画面を作り直す
      window.location.reload();
    });
  }

  async function makeInvite() {
    if (!household || !user) return;
    await run(async () => {
      const code = await createInvite(household, user.uid);
      setLink(inviteLink(window.location.origin, code));
      setCopied(false);
    });
  }

  async function copyLink() {
    await navigator.clipboard.writeText(link).catch(() => undefined);
    setCopied(true);
  }

  async function shareLink() {
    if (navigator.share) await navigator.share({ title: "くらしノートへの招待", text: `「${household?.name}」への招待です`, url: link }).catch(() => undefined);
    else await copyLink();
  }

  async function leave() {
    if (!household || !user) return;
    if (!window.confirm(`「${household.name}」から抜けます。抜けると、家の在庫やレシピは見えなくなり、自分の前のデータに戻ります。よろしいですか？`)) return;
    await run(async () => {
      await leaveHousehold(user.uid, household);
      await refreshHousehold();
      window.location.reload();
    });
  }

  async function remove(memberUid: string, name: string) {
    if (!household) return;
    if (!window.confirm(`${name}さんを家から外します。よろしいですか？`)) return;
    await run(async () => {
      await removeMember(household, memberUid);
      await refreshHousehold();
    });
  }

  return (
    <div className="ui-stack">
      <div className="ui-page-head">
        <div className="flex items-center gap-3"><Users size={25} className="text-[var(--brand)]" /><h1 className="ui-page-title">同居人と共有</h1></div>
      </div>

      <section className="ui-section">
        <p className="ui-muted">
          共有するのは <strong>なかみメモ（在庫）</strong> と <strong>つくりおきノート（レシピ・献立・買い物リスト）</strong> だけです。
          <strong>お金管理は共有しません。</strong>
        </p>
      </section>

      {!household ? (
        <section className="ui-section">
          <h2 className="ui-section__title">家を作る</h2>
          <p className="ui-muted">今あなたが使っている在庫とレシピを「家」に写して、同居人を招待できるようにします。今までのデータは消さずに残ります。</p>
          <button type="button" onClick={create} disabled={busy} className="ui-button ui-button--primary mt-3">
            {busy ? progress || "作っています" : "家を作って共有をはじめる"}
          </button>
        </section>
      ) : (
        <>
          <section className="ui-section">
            <h2 className="ui-section__title">{household.name}</h2>
            <ul className="ui-list mt-2">
              {household.memberUids.map((memberUid) => {
                const name = household.memberNames[memberUid] || "メンバー";
                return (
                  <li key={memberUid} className="ui-household-member">
                    <span>{name}{memberUid === household.ownerUid && <span className="ui-muted">（作った人）</span>}{memberUid === user.uid && <span className="ui-muted">（あなた）</span>}</span>
                    {isOwner && memberUid !== user.uid && (
                      <button type="button" onClick={() => remove(memberUid, name)} disabled={busy} className="ui-button ui-button--ghost">外す</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="ui-section">
            <h2 className="ui-section__title">同居人を招待する</h2>
            <p className="ui-muted">リンクを作って、LINE などで同居人に送ってください。同居人は自分の Google アカウントでログインして「参加する」を押すだけです。リンクは{INVITE_DAYS}日で使えなくなります。</p>
            {link ? (
              <div className="ui-household-link mt-3">
                <input readOnly value={link} onFocus={(event) => event.currentTarget.select()} aria-label="招待リンク" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={shareLink} className="ui-button ui-button--primary"><Share2 size={16} />送る</button>
                  <button type="button" onClick={copyLink} className="ui-button ui-button--secondary">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "コピーしました" : "コピー"}</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={makeInvite} disabled={busy} className="ui-button ui-button--primary mt-3">招待リンクを作る</button>
            )}
          </section>

          {!isOwner && (
            <section className="ui-section">
              <button type="button" onClick={leave} disabled={busy} className="ui-button ui-button--danger">この家から抜ける</button>
            </section>
          )}
        </>
      )}

      {error && <p role="alert" className="ui-error">{error}</p>}
    </div>
  );
}
