import Link from "next/link";

export function EmptyState({
  title,
  actionLabel,
  href,
}: {
  title: string;
  actionLabel?: string;
  href?: string;
}) {
  return (
    <div className="ui-empty">
      <h2 className="ui-empty__title">{title}</h2>
      {actionLabel && href && <Link href={href} className="ui-button ui-button--primary">{actionLabel}</Link>}
    </div>
  );
}

