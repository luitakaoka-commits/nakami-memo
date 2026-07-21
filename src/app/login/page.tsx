import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { LoadingState } from "@/components/common/LoadingState";

export default function LoginPage() {
  return (
    <main className="ui-public-page">
      <Suspense fallback={<LoadingState label="ログイン画面を準備中" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}

