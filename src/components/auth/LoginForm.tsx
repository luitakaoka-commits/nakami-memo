"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Box, LogIn } from "lucide-react";
import { signInWithEmail, signInWithGoogle, signUpWithEmail } from "@/lib/firebase/auth";
import { useAuth } from "@/lib/hooks/useAuth";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") ?? "/app";
  const { user } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) router.replace(redirect);
  }, [redirect, router, user]);

  async function handleGoogle() {
    setError("");
    setSubmitting(true);
    try {
      await signInWithGoogle();
      router.replace(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Googleログインに失敗しました。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "signup") await signUpWithEmail({ email, password, displayName });
      else await signInWithEmail({ email, password });
      router.replace(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインに失敗しました。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ui-auth-card">
      <div className="ui-auth-header">
        <span className="ui-brand-mark ui-brand-mark--small" aria-hidden="true"><Box size={21} strokeWidth={1.8} /></span>
        <span className="ui-brand-name">なかみメモ</span>
        <h1 className="ui-auth-title">{mode === "signup" ? "アカウント作成" : "ログイン"}</h1>
      </div>

      <button type="button" onClick={handleGoogle} disabled={submitting} className="ui-button ui-button--secondary ui-button--full">Googleでログイン</button>

      <form className="ui-stack" onSubmit={handleSubmit}>
        {mode === "signup" && <label className="ui-form-field">表示名<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>}
        <label className="ui-form-field">メールアドレス<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="ui-form-field">パスワード<input type="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p role="alert" className="ui-error">{error}</p>}
        <button type="submit" disabled={submitting} className="ui-button ui-button--primary ui-button--full"><LogIn size={17} strokeWidth={2} />{mode === "signup" ? "作成" : "ログイン"}</button>
      </form>

      <button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")} className="ui-button ui-button--ghost ui-button--full mt-3">
        {mode === "login" ? "新規登録" : "ログインに戻る"}
      </button>
    </div>
  );
}

