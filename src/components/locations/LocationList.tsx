"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { deleteLocation } from "@/lib/firebase/firestore";
import { useAreas } from "@/lib/hooks/useAreas";
import { useAuth } from "@/lib/hooks/useAuth";
import { useLocations } from "@/lib/hooks/useLocations";
import { sortAreas, sortLocations } from "@/lib/utils/inventory";
import { Badge } from "@/components/common/Badge";
import { ConfirmDeleteButton } from "@/components/common/ConfirmDeleteButton";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";

export function LocationList() {
  const { user } = useAuth();
  const { areas, loading: areasLoading } = useAreas(user?.uid);
  const { locations, loading: locationsLoading } = useLocations(user?.uid);
  const [error, setError] = useState("");

  const grouped = useMemo(() => {
    return sortAreas(areas).map((area) => ({
      area,
      locations: sortLocations(locations.filter((location) => location.areaId === area.id)),
    }));
  }, [areas, locations]);

  if (areasLoading || locationsLoading) return <LoadingState label="保管場所を読み込み中" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-black text-slate-900">保管場所</h1>
          <p className="mt-1 text-sm text-slate-500">エリア別に表示。手動並び順を優先します。</p>
        </div>
        <div className="flex gap-2">
          <Link href="/app/areas" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">エリア管理</Link>
          <Link href="/app/locations/new" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">追加</Link>
        </div>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {locations.length === 0 ? (
        <EmptyState title="まだ保管場所がありません" description="冷蔵庫、食品棚、収納ボックスなどを追加しましょう。" actionLabel="保管場所を追加" href="/app/locations/new" />
      ) : (
        <div className="space-y-6">
          {grouped.map(({ area, locations: areaLocations }) => (
            areaLocations.length > 0 && (
              <section key={area.id}>
                <h2 className="mb-3 text-sm font-bold text-slate-500">{area.name}</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {areaLocations.map((location) => (
                    <article key={location.id} className="overflow-hidden rounded-3xl bg-white shadow-sm">
                      <Link href={`/app/locations/${location.id}`} className="block">
                        <div className="relative h-32 bg-slate-100">
                          {location.imageUrl ? <Image src={location.imageUrl} alt={location.name} fill sizes="320px" className="object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-slate-400">No Image</div>}
                        </div>
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="font-bold text-slate-900">{location.name}</h3>
                              <p className="mt-1 text-xs text-slate-500">{location.type || "種類未設定"}</p>
                            </div>
                            {location.isPublic && <Badge tone="blue">公開ON</Badge>}
                          </div>
                          {location.memo && <p className="mt-3 line-clamp-2 text-sm text-slate-500">{location.memo}</p>}
                        </div>
                      </Link>
                      <div className="flex gap-2 border-t border-slate-100 p-3">
                        <Link href={`/app/locations/${location.id}/edit`} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">編集</Link>
                        <Link href={`/app/locations/${location.id}/qr`} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">QR</Link>
                        <ConfirmDeleteButton
                          onConfirm={async () => {
                            if (!user) return;
                            setError("");
                            try {
                              await deleteLocation(user.uid, location.id);
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "削除できませんでした。");
                            }
                          }}
                          message="この保管場所を削除しますか？中身がある場合は削除できません。"
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )
          ))}
        </div>
      )}
    </div>
  );
}
