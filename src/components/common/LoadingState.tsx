export function LoadingState({ label = "読み込み中" }: { label?: string }) {
  return (
    <div role="status" className="ui-loading">
      <div><div className="ui-loading__spinner" aria-hidden="true" /><p className="ui-muted">{label}</p></div>
    </div>
  );
}

