"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { LoadingState } from "@/components/common/LoadingState";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [loading, pathname, router, user]);

  if (loading) return <LoadingState label="ログイン状態を確認中" />;
  if (!user) return <LoadingState label="ログイン画面へ移動中" />;

  return <>{children}</>;
}
