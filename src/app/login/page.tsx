import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { LoadingState } from "@/components/common/LoadingState";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4 py-10">
      <Suspense fallback={<LoadingState label="ログイン画面を準備中" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
