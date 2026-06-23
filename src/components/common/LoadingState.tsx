export function LoadingState({ label = "読み込み中" }: { label?: string }) {
  return (
    <div className="flex min-h-[240px] items-center justify-center rounded-3xl bg-white p-8 text-center shadow-soft">
      <div>
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
        <p className="text-sm font-medium text-slate-600">{label}...</p>
      </div>
    </div>
  );
}
