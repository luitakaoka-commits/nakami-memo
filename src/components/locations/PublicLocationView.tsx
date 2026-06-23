"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebase/client";
import type { PublicLocation } from "@/lib/types/public-location";
import { LoadingState } from "@/components/common/LoadingState";

export function PublicLocationView() {
  const params = useParams<{ publicToken: string }>();
  const [data, setData] = useState<PublicLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!params.publicToken) return;
    const unsubscribe = onSnapshot(
      doc(db, "publicLocations", params.publicToken),
      (snapshot) => {
        if (!snapshot.exists()) {
          setNotFound(true);
          setData(null);
        } else {
          setData(snapshot.data() as PublicLocation);
          setNotFound(false);
        }
        setLoading(false);
      },
      () => {
        setNotFound(true);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [params.publicToken]);

  if (loading) return <LoadingState label="公開リストを読み込み中" />;
  if (notFound || !data || !data.isPublic) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-lg rounded-3xl bg-white p-6 text-center shadow-soft">
          <h1 className="text-xl font-black text-slate-900">公開されていません</h1>
          <p className="mt-2 text-sm text-slate-500">公開OFF、またはURLが間違っている可能性があります。</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <section className="mx-auto max-w-lg rounded-3xl bg-white p-5 shadow-soft">
        <p className="text-sm font-bold text-brand-700">なかみメモ 公開リスト</p>
        <h1 className="mt-2 text-2xl font-black text-slate-900">{data.labelName || data.locationName}</h1>
        <p className="mt-1 text-sm text-slate-500">{data.areaName} / {data.locationName}</p>

        <div className="mt-6 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100">
          {data.items.length ? data.items.map((item, index) => (
            <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-4 bg-white p-4">
              <p className="font-bold text-slate-900">{item.name}</p>
              <p className="shrink-0 text-lg font-black text-slate-900">{item.quantity}<span className="ml-1 text-sm font-semibold text-slate-500">{item.unit}</span></p>
            </div>
          )) : <p className="p-4 text-sm text-slate-500">中身は登録されていません。</p>}
        </div>

        <p className="mt-4 text-xs leading-5 text-slate-400">この公開画面では、写真・メモ・期限・カテゴリ・状態メモは表示しません。</p>
      </section>
    </main>
  );
}
