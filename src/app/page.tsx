import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4 py-10">
      <section className="mx-auto flex max-w-4xl flex-col items-center rounded-[2rem] bg-white p-8 text-center shadow-soft sm:p-12">
        <span className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-600 text-2xl font-black text-white">中</span>
        <p className="mt-6 text-sm font-bold text-brand-700">なかみメモ</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">家の中身を、ゆるく全部メモ。</h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600">
          冷蔵庫、収納ボックス、防災備蓄、ケーブル類まで。QRコードを貼って、開ける前に中身を確認できます。
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/login" className="rounded-2xl bg-brand-600 px-6 py-3 text-sm font-bold text-white hover:bg-brand-700">
            ログインして始める
          </Link>
          <Link href="/app" className="rounded-2xl border border-slate-200 px-6 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
            アプリを開く
          </Link>
        </div>
      </section>
    </main>
  );
}
