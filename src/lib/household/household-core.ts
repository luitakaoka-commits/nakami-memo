/**
 * 同居人との共有（「家」）の、ネットワークを使わない部分（2026-09-28）。
 *
 * なかみメモとつくりおきノートのデータは、これまで本人だけの場所（users/{uid}/…）にあった。
 * 共有するときは「家」（households/{householdId}/…）に置き、家のメンバー全員が読み書きする。
 * お金管理は workspaces/{…} にあり、同居人を招かなければ共有されない（ユーザーの希望どおり）。
 *
 * 「家」を作るまでは今までどおり users/{uid} を使う。作った瞬間に中身を家へ写し、
 * users/{uid} の householdId を書いて切り替える。元のデータは消さない（戻せるように）。
 */

/** 家に写すコレクション。なかみメモ（areas〜consumptions）とつくりおきノート（recipes〜shopping） */
export const HOUSEHOLD_COLLECTIONS = ["areas", "locations", "items", "tools", "consumptions", "recipes", "plans", "shopping"] as const;

/**
 * 「使い切った／捨てた」をお金管理へ返す受け渡し箱（ユーザー決定 B）。
 * 同居人はあなたのお金管理を見られないので、家の中に置いておき、あなたがお金管理を開いたときに書き戻す。
 */
export const OUTCOME_QUEUE = "outcomeQueue";

/** 招待リンクの有効日数 */
export const INVITE_DAYS = 7;

/** データの置き場所。家があれば households/{id}、無ければ users/{uid} */
export function spaceSegments(uid: string, householdId: string | null | undefined): [string, string] {
  return householdId ? ["households", householdId] : ["users", uid];
}

/**
 * 招待コード。推測されないよう、英数字24文字を暗号用の乱数から作る。
 * random は 0〜255 の整数を返す関数（テストで固定できるように外から渡す）。
 */
export function newInviteCode(random: () => number): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  while (code.length < 24) {
    const value = random() & 0xff;
    // 偏りを避けるため、文字数の倍数に収まる値だけ使う
    if (value < 256 - (256 % alphabet.length)) code += alphabet[value % alphabet.length];
  }
  return code;
}

export function inviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/app/join?code=${encodeURIComponent(code)}`;
}

export function inviteExpiry(nowMillis: number): number {
  return nowMillis + INVITE_DAYS * 24 * 60 * 60 * 1000;
}

/** 招待コードを使えるか。 */
export function inviteStatus(
  invite: { householdId?: unknown; expiresAtMillis?: unknown } | null | undefined,
  nowMillis: number,
): "ok" | "missing" | "expired" {
  if (!invite || typeof invite.householdId !== "string" || !invite.householdId) return "missing";
  const expires = Number(invite.expiresAtMillis);
  if (!Number.isFinite(expires) || expires <= nowMillis) return "expired";
  return "ok";
}

export function defaultHouseholdName(displayName: string | null | undefined): string {
  const name = String(displayName ?? "").trim();
  return name ? `${name}さんの家` : "わが家";
}

/** 写し終わったあと、件数がそろっているか。そろっていないコレクション名を返す */
export function copyMismatches(source: Record<string, number>, copied: Record<string, number>): string[] {
  return HOUSEHOLD_COLLECTIONS.filter((name) => (source[name] ?? 0) !== (copied[name] ?? 0));
}

/**
 * お金管理へ返す必要がある在庫か（レシートから入れた在庫だけ）。
 * 家に入っているときは、直接書かずに受け渡し箱へ入れる（同居人はお金管理に書けないため）。
 */
export function shouldQueueOutcome(
  householdId: string | null | undefined,
  item: { purchaseWorkspaceId?: unknown; purchaseRef?: unknown },
): boolean {
  return Boolean(householdId) && Boolean(item?.purchaseWorkspaceId || item?.purchaseRef);
}

export type OutcomeQueueEntry = {
  inventoryItemId: string;
  purchaseWorkspaceId: string;
  outcome: string;
  outcomeAt: string;
  outcomeReason: string;
  recordedBy: string;
  itemName: string;
};

/** 受け渡し箱に入れる1件 */
export function outcomeQueueEntry(
  item: { id: string; name?: unknown; purchaseWorkspaceId?: unknown },
  patch: { outcome: string; outcomeAt: string; outcomeReason: string },
  recordedBy: string,
): OutcomeQueueEntry {
  return {
    inventoryItemId: item.id,
    purchaseWorkspaceId: String(item.purchaseWorkspaceId ?? ""),
    outcome: patch.outcome,
    outcomeAt: patch.outcomeAt,
    outcomeReason: patch.outcomeReason,
    recordedBy,
    itemName: String(item.name ?? ""),
  };
}
