import type { NextConfig } from "next";

/**
 * next/image のリモート許可は、自分のSupabaseプロジェクトのホストだけに絞る。
 *
 * `**.supabase.co` のワイルドカードにすると、任意のSupabaseプロジェクトの公開ストレージを
 * このアプリ経由で配信できてしまう（オープン画像プロキシ）ので使わない。
 *
 * ホスト名は画像URLに元から露出している公開情報なので、直接書いてよい。
 * 環境変数にしないのは、ビルド環境に SUPABASE_URL を入れ忘れると
 * 画像が黙って表示されなくなるため（デプロイ先を増やすたびに踏む）。
 * プロジェクトを移す場合だけ、SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL で上書きできる。
 */
const DEFAULT_SUPABASE_HOSTNAME = "gcqdjcgolhtgnkxenlwk.supabase.co";

function resolveSupabaseHostname(): string {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!rawUrl) return DEFAULT_SUPABASE_HOSTNAME;
  try {
    return new URL(rawUrl).hostname;
  } catch {
    console.warn(
      `[next.config] SUPABASE_URL の形式が不正です（${rawUrl}）。既定のホスト名を使います。`,
    );
    return DEFAULT_SUPABASE_HOSTNAME;
  }
}

/**
 * 3アプリを1つのVercelプロジェクトに同居させている。
 *   /            なかみメモ（このNext.jsアプリ本体）
 *   /money/      お金管理（public/money/ の素のHTML+JS）
 *   /recipe/     つくりおきノート（public/recipe/ の素のHTML+JS）
 *
 * public/ 配下は Next.js がそのまま配信するので、/money/index.html は既に見える。
 * 短いURL /money と /recipe からそこへ送る。
 *
 * ここは rewrite ではなく redirect にしている。
 * rewrite だとブラウザ上のURLが /money のままなので、HTML内の相対パス
 * （styles.css や app.js）が /money/styles.css ではなく /styles.css に解決されてしまい、
 * 全部404になってアプリが起動しない。redirect ならURL自体が /money/index.html になるので、
 * 相対パスが正しく /money/ 配下を指す。
 *
 * 末尾スラッシュの /money/ を使わないのは、Next.js が trailingSlash: false の既定で
 * /money/ → /money へ戻してしまい、噛み合わないため。
 *
 * permanent: false なのは、この構成を後で変える余地を残すため
 * （308だとブラウザが恒久的にキャッシュしてしまう）。
 *
 * 同一オリジンなので、Firebase Auth のセッションと /api/images/upload を3アプリで共有できる。
 */
const staticAppRedirects = [
  { source: "/money", destination: "/money/index.html", permanent: false },
  { source: "/recipe", destination: "/recipe/index.html", permanent: false },
  // 3アプリの Firebase を cash-manege にまとめるときの、データの引っ越しページ（2026-09-14）。
  // 引っ越しが済んで古いプロジェクトを片付けたら、public/migrate/ ごと消す。
  { source: "/migrate", destination: "/migrate/index.html", permanent: false },
];

/**
 * Google ログインの受け口（/__/auth/…）を、このサイトから Firebase（cash-manege.firebaseapp.com）へ中継する（2026-09-28）。
 *
 * 以前は authDomain が cash-manege.firebaseapp.com で、ログインの途中だけ別のサイトを通っていた。
 * Chrome などは別のサイトの保存領域を仕切るので、インストールしたアプリからのログイン（リダイレクト方式）で
 * 「Unable to process request due to missing initial state」と出て止まった（ユーザーの実機、つくりおきノート）。
 * Firebase 公式の対処（redirect-best-practices の Option 3）どおり、受け口を同じサイトに置き、authDomain を
 * nakami-memo.vercel.app にした。3アプリの authDomain は public/shared/rules.test.mjs が揃っているか確かめる。
 *
 * **Google Cloud の OAuth クライアントに https://nakami-memo.vercel.app/__/auth/handler を
 * 承認済みのリダイレクト URI として足しておかないと、Google ログインが redirect_uri_mismatch で失敗する。**
 * ここは rewrite（中継）でよい。受け口のページは /__/auth/ の下の相対パスしか読まないので、上の redirect の事故は起きない。
 */
const FIREBASE_AUTH_PROXY = "https://cash-manege.firebaseapp.com";

const authProxyRewrites = [
  { source: "/__/auth/:path*", destination: `${FIREBASE_AUTH_PROXY}/__/auth/:path*` },
  { source: "/__/firebase/:path*", destination: `${FIREBASE_AUTH_PROXY}/__/firebase/:path*` },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return staticAppRedirects;
  },
  async rewrites() {
    return authProxyRewrites;
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: resolveSupabaseHostname(),
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
