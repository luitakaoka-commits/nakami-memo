import Link from "next/link";
import { ArrowRight, Box } from "lucide-react";

export default function HomePage() {
  return (
    <main className="ui-public-page">
      <section className="ui-entry-card">
        <span className="ui-brand-mark mx-auto" aria-hidden="true"><Box size={30} strokeWidth={1.8} /></span>
        <h1 className="ui-entry-title">なかみメモ</h1>
        <div className="mt-9 grid gap-2">
          <Link href="/login" className="ui-button ui-button--primary ui-button--full">ログイン<ArrowRight size={17} strokeWidth={2} /></Link>
          <Link href="/app" className="ui-button ui-button--secondary ui-button--full">アプリを開く</Link>
        </div>
      </section>
    </main>
  );
}

