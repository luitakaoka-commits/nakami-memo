import { collection, doc, getDocs, serverTimestamp, writeBatch } from "firebase/firestore";
import { monthlyDocs, seriesFromDocs, type HealthSeries } from "@/lib/health/samsung-core";
import { db } from "./client";

/*
 * からだの記録（Samsung Health から取り込んだ日ごとの値）の読み書き（2026-09-28）。
 *   users/{uid}/health/{項目}_{YYYY-MM}   { metric, month, values: { "2026-09-28": 72, … } }
 * **健康データなので、同居人と共有する「家」には入れない。** 家に入っていても必ず本人の場所を使う
 * （space.ts を通さない）。ルールも users/{uid} の下にだけ health を許している。
 */
const healthCollection = (uid: string) => collection(db, "users", uid, "health");

/** 取り込んだ値を保存する。同じ日の値は上書き、ほかの日はそのまま残す */
export async function saveHealthSeries(uid: string, series: HealthSeries): Promise<number> {
  const docs = monthlyDocs(series);
  for (let start = 0; start < docs.length; start += 400) {
    const batch = writeBatch(db);
    docs.slice(start, start + 400).forEach((entry) => {
      batch.set(doc(healthCollection(uid), entry.id), {
        metric: entry.metric,
        month: entry.month,
        values: entry.values,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
  }
  return docs.length;
}

export async function readHealthSeries(uid: string): Promise<HealthSeries> {
  const snap = await getDocs(healthCollection(uid));
  return seriesFromDocs(snap.docs.map((entry) => entry.data()));
}

/** からだの記録を全部消す（本人がいつでも消せるように） */
export async function deleteAllHealth(uid: string): Promise<number> {
  const snap = await getDocs(healthCollection(uid));
  for (let start = 0; start < snap.docs.length; start += 400) {
    const batch = writeBatch(db);
    snap.docs.slice(start, start + 400).forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
  }
  return snap.size;
}
