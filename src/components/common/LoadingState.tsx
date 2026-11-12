// スケルトン（淡色 --soft の帯）で読み込み中を示す。文言は読み上げ用に残す
export function LoadingState({ label = "読み込み中" }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" className="ui-loading">
      <span className="ui-skeleton ui-skeleton--short" aria-hidden="true" />
      <span className="ui-skeleton ui-skeleton--lead" aria-hidden="true" />
      <span className="ui-skeleton" aria-hidden="true" />
      <span className="ui-skeleton" aria-hidden="true" />
      <p className="ui-loading__label">{label}</p>
    </div>
  );
}
