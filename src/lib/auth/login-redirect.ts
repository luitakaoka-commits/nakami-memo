/**
 * ログインしていないときに開いた画面へ、ログインのあと戻るための行き先（2026-09-28）。
 *
 * 以前は画面のパスだけ（/app/join）を覚えていて、`?code=…` を落としていた。
 * そのため、ログインしていない同居人が招待リンクを開くと、ログインのあと招待コードの無い画面に戻り、
 * 「この招待リンクは使えません」と出て参加できなかった（ユーザーの実機）。
 */
export function loginRedirectPath(pathname: string, search: string): string {
  const query = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `/login?redirect=${encodeURIComponent(`${pathname}${query}`)}`;
}

/**
 * ログインのあとに戻る先。外部サイトへの飛ばし（オープンリダイレクト）を防ぐ。
 * "//evil.example.com" や "/\evil.example.com" はブラウザが別のサイトとして読むので、"/" 始まりだけでは不十分。
 */
export function safeRedirect(value: string | null): string {
  if (!value) return "/app";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/app";
  return value;
}
