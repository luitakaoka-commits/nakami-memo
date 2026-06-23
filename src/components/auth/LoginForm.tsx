"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
      if (mode === "signup") {
        await signUpWithEmail({ email, password, displayName });
      } else {
        await signInWithEmail({ email, password });
      }
      router.replace(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインに失敗しました。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-3xl bg-white p-6 shadow-soft">
      <div className="mb-6 text-center">
        <p className="text-sm font-semibold text-brand-600">なかみメモ</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">ログイン</h1>
        <p className="mt-2 text-sm text-slate-500">家の中身、ここに集合。なくし物にも賞味期限にも圧をかけます。</p>
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={submitting}
        className="mb-4 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        Googleでログイン
      </button>

      <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        または
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        {mode === "signup" && (
          <label className="block text-sm font-medium text-slate-700">
            表示名
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-1 w-full rounded-xl border-slate-200"
              placeholder="まに"
            />
          </label>
        )}
        <label className="block text-sm font-medium text-slate-700">
          メールアドレス
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-xl border-slate-200"
            placeholder="name@example.com"
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          パスワード
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-xl border-slate-200"
            placeholder="6文字以上"
          />
        </label>

        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {mode === "signup" ? "アカウント作成" : "ログイン"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        className="mt-4 w-full text-sm font-medium text-brand-700"
      >
        {mode === "login" ? "新規登録はこちら" : "ログインに戻る"}
      </button>
    </div>
  );
}
