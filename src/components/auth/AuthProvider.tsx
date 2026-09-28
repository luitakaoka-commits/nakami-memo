"use client";

import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { ensureUserDocument } from "@/lib/firebase/firestore";
import { loadMembership, type Household } from "@/lib/firebase/household";
import { setActiveHousehold } from "@/lib/firebase/space";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  /** 同居人と共有している「家」。入っていなければ null（2026-09-28） */
  household: Household | null;
  /** 家を作った・入った・抜けたあとに呼ぶ */
  refreshHousehold: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setActiveHousehold(null);
        setHousehold(null);
        setUser(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      await ensureUserDocument(currentUser.uid, currentUser.displayName, currentUser.email).catch(() => undefined);
      // どの家に入っているかが決まるまで画面を出さない。先に出すと、本人の場所を読んでから家に切り替わり、
      // 在庫が一瞬ちがって見える（2026-09-28）
      const membership = await loadMembership(currentUser.uid);
      setActiveHousehold(membership?.id ?? null);
      setHousehold(membership);
      setUser(currentUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const refreshHousehold = useCallback(async () => {
    if (!user) return;
    const membership = await loadMembership(user.uid);
    setActiveHousehold(membership?.id ?? null);
    setHousehold(membership);
  }, [user]);

  const value = useMemo(() => ({ user, loading, household, refreshHousehold }), [user, loading, household, refreshHousehold]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
