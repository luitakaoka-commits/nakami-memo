import {
  Timestamp,
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import {
  HOUSEHOLD_COLLECTIONS,
  copyMismatches,
  defaultHouseholdName,
  inviteExpiry,
  newInviteCode,
} from "@/lib/household/household-core";
import { db } from "./client";
import { syncPublicLocation } from "./public-location";
import { usersDoc } from "./refs";
import { setActiveHousehold } from "./space";

/*
 * 同居人との共有（「家」）の読み書き（2026-09-28）。
 *   households/{id}             名前・持ち主・メンバー（memberUids）・メンバーの表示名（memberNames）
 *   households/{id}/{…}         なかみメモとつくりおきノートのデータ（HOUSEHOLD_COLLECTIONS）
 *   householdInvites/{code}     招待コード（7日で切れる）。コードを知っている人だけが参加できる
 * お金管理（workspaces）はここに入れない。同居人と共有しないため。
 */

export type Household = {
  id: string;
  name: string;
  ownerUid: string;
  memberUids: string[];
  memberNames: Record<string, string>;
};

const householdDoc = (id: string) => doc(db, "households", id);
const inviteDoc = (code: string) => doc(db, "householdInvites", code);

function toHousehold(id: string, data: Record<string, unknown>): Household {
  return {
    id,
    name: String(data.name ?? ""),
    ownerUid: String(data.ownerUid ?? ""),
    memberUids: Array.isArray(data.memberUids) ? data.memberUids.map(String) : [],
    memberNames: (data.memberNames && typeof data.memberNames === "object" ? data.memberNames : {}) as Record<string, string>,
  };
}

/**
 * ログイン直後に、どの家に入っているかを調べる。入っていなければ null（今までどおり本人の場所を使う）。
 * 家から外された・家が消えたときも null（読めないので）。
 */
export async function loadMembership(uid: string): Promise<Household | null> {
  const profile = await getDoc(usersDoc(uid)).catch(() => null);
  const householdId = profile?.data()?.householdId;
  if (typeof householdId !== "string" || !householdId) return null;
  try {
    const snap = await getDoc(householdDoc(householdId));
    if (!snap.exists()) return null;
    const household = toHousehold(snap.id, snap.data());
    return household.memberUids.includes(uid) ? household : null;
  } catch {
    return null;
  }
}

async function countDocs(segments: [string, string], name: string) {
  return (await getDocs(collection(db, ...segments, name))).size;
}

/**
 * 家を作り、今のデータ（本人の場所）を家へ写して切り替える。
 * 写し終わったら件数を突き合わせ、そろわなければ切り替えない（本人の場所のまま使える）。
 * 元のデータは消さない。
 */
export async function createHouseholdFromPersonal(user: User, onProgress: (message: string) => void): Promise<Household> {
  const uid = user.uid;
  const ref = doc(collection(db, "households"));
  const name = defaultHouseholdName(user.displayName);
  const displayName = user.displayName || user.email || "メンバー";
  await setDoc(ref, {
    name,
    ownerUid: uid,
    memberUids: [uid],
    memberNames: { [uid]: displayName },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const source: Record<string, number> = {};
  const copied: Record<string, number> = {};
  for (const name of HOUSEHOLD_COLLECTIONS) {
    onProgress(`${name} を写しています…`);
    const snap = await getDocs(collection(db, "users", uid, name));
    source[name] = snap.size;
    // 1回のまとめ書きは500件まで。余裕をみて400件ずつ
    for (let start = 0; start < snap.docs.length; start += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(start, start + 400).forEach((entry) => batch.set(doc(db, "households", ref.id, name, entry.id), entry.data()));
      await batch.commit();
    }
    copied[name] = await countDocs(["households", ref.id], name);
  }

  const mismatched = copyMismatches(source, copied);
  if (mismatched.length) {
    throw new Error(`写した件数が合いません（${mismatched.join("・")}）。今までの場所のまま使えます。もう一度お試しください。`);
  }

  await setDoc(usersDoc(uid), { householdId: ref.id }, { merge: true });
  setActiveHousehold(ref.id);

  // QR で公開している保管場所は、家のメンバーが直せるように書き直す（householdId を入れる）
  onProgress("公開ページを合わせています…");
  const locations = await getDocs(collection(db, "households", ref.id, "locations"));
  for (const location of locations.docs) {
    if (location.data().isPublic) await syncPublicLocation(uid, location.id).catch(() => undefined);
  }

  return { id: ref.id, name, ownerUid: uid, memberUids: [uid], memberNames: { [uid]: displayName } };
}

/** 招待コードを作る（7日で切れる）。 */
export async function createInvite(household: Household, uid: string): Promise<string> {
  const code = newInviteCode(() => crypto.getRandomValues(new Uint8Array(1))[0]);
  await setDoc(inviteDoc(code), {
    householdId: household.id,
    householdName: household.name,
    createdBy: uid,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(inviteExpiry(Date.now())),
  });
  return code;
}

export async function readInvite(code: string) {
  const snap = await getDoc(inviteDoc(code));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    householdId: String(data.householdId ?? ""),
    householdName: String(data.householdName ?? ""),
    expiresAtMillis: data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : Number(data.expiresAt ?? 0),
  };
}

/**
 * 招待コードで家に入る。ルールは「コードが有効で、自分1人だけを足す」ときにだけ許す。
 * 自分の今までのデータ（本人の場所）はそのまま残り、家のデータを見るようになる。
 */
export async function joinHousehold(user: User, code: string, householdId: string) {
  await updateDoc(householdDoc(householdId), {
    memberUids: arrayUnion(user.uid),
    [`memberNames.${user.uid}`]: user.displayName || user.email || "メンバー",
    joinedWith: code,
    updatedAt: serverTimestamp(),
  });
  await setDoc(usersDoc(user.uid), { householdId }, { merge: true });
}

/** 家から抜ける（持ち主以外）。抜けたあとは、自分の今までの場所に戻る。 */
export async function leaveHousehold(uid: string, household: Household) {
  await updateDoc(householdDoc(household.id), {
    memberUids: arrayRemove(uid),
    [`memberNames.${uid}`]: deleteField(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(usersDoc(uid), { householdId: deleteField() }, { merge: true });
}

/** 持ち主がメンバーを外す。 */
export async function removeMember(household: Household, memberUid: string) {
  await updateDoc(householdDoc(household.id), {
    memberUids: arrayRemove(memberUid),
    [`memberNames.${memberUid}`]: deleteField(),
    updatedAt: serverTimestamp(),
  });
}
