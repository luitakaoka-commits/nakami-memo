export function ErrorState({
  error,
  title = "データを読み込めませんでした。",
}: {
  error?: Error | string | null;
  title?: string;
}) {
  const detail = typeof error === "string" ? error : error?.message;

  return (
    <div role="alert" className="ui-empty">
      <h2 className="ui-empty__title">{title}</h2>
      <p className="ui-muted">{detail || "通信状態を確認して、ページを再読み込みしてください。"}</p>
    </div>
  );
}
