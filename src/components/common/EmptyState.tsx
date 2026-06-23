import Link from "next/link";

export function EmptyState({
  title,
  description,
  actionLabel,
  href,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  href?: string;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {description && <p className="mt-2 text-sm text-slate-500">{description}</p>}
      {actionLabel && href && (
        <Link href={href} className="mt-5 inline-flex rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
