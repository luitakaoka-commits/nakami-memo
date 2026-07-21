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
      <main className="ui-public-page">
        <div className="ui-public-card text-center">
          <h1 className="ui-page-title">公開されていません</h1>
        </div>
      </main>
    );
  }

  return (
      <main className="ui-public-page">
      <section className="ui-public-card">
        <p className="ui-kicker">なかみメモ</p>
        <h1 className="ui-page-title">{data.labelName || data.locationName}</h1>
        <p className="ui-muted mt-2">{data.areaName} / {data.locationName}</p>

        <div className="ui-public-list">
          {data.items.length ? data.items.map((item, index) => (
            <div key={`${item.name}-${index}`} className="ui-public-row">
              <p className="ui-public-row__name">{item.name}</p>
              <p className="ui-public-row__quantity">{item.quantity}<span className="ml-1 text-sm font-semibold text-[var(--ink-muted)]">{item.unit}</span></p>
            </div>
          )) : <p className="p-4 ui-muted">アイテムなし</p>}
        </div>
      </section>
    </main>
  );
}

