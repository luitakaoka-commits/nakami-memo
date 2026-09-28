import { collection, doc } from "firebase/firestore";
import { spaceSegments } from "@/lib/household/household-core";
import { db } from "./client";

/*
 * データの置き場所を決める唯一の入口（2026-09-28）。
 * 家（households/{id}）に入っていれば家、入っていなければ本人の場所（users/{uid}）。
 *
 * ログイン直後に AuthProvider が users/{uid} の householdId を読んで setActiveHousehold を呼ぶ。
 * それが済むまでは画面を出さない（先に users/{uid} を読みに行って、あとから家に切り替わるのを防ぐ）。
 * refs.ts・kitchen.ts はすべてここを通すので、コレクションの場所を直に書かないこと。
 */
let activeHouseholdId: string | null = null;

export function setActiveHousehold(householdId: string | null) {
  activeHouseholdId = householdId || null;
}

export function getActiveHousehold(): string | null {
  return activeHouseholdId;
}

export function spaceCollection(userId: string, name: string) {
  return collection(db, ...spaceSegments(userId, activeHouseholdId), name);
}

export function spaceDoc(userId: string, name: string, id: string) {
  return doc(db, ...spaceSegments(userId, activeHouseholdId), name, id);
}
