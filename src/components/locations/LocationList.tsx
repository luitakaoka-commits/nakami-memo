"use client";

import Image from "next/image";
import Link from "next/link";
import { Box, Plus } from "lucide-react";
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
  const grouped = useMemo(() => sortAreas(areas).map((area) => ({ area, locations: sortLocations(locations.filter((location) => location.areaId === area.id)) })), [areas, locations]);

  if (areasLoading || locationsLoading) return <LoadingState label="保管場所を読み込み中" />;

  return (
    <div className="ui-stack">
      <div className="ui-page-head">
        <div className="flex items-center gap-3"><Box size={25} className="text-[var(--blue)]" /><h1 className="ui-page-title">保管場所</h1></div>
        <div className="ui-page-head__actions">
          <Link href="/app/areas" className="ui-button ui-button--secondary">エリア管理</Link>
          <Link href="/app/locations/new" className="ui-button ui-button--primary"><Plus size={17} strokeWidth={2} />追加</Link>
        </div>
      </div>

      {error && <p role="alert" className="ui-error">{error}</p>}

      {locations.length === 0 ? <EmptyState title="保管場所がありません" actionLabel="保管場所を追加" href="/app/locations/new" /> : (
        <div className="ui-stack">
          {grouped.map(({ area, locations: areaLocations }) => areaLocations.length > 0 && (
            <section key={area.id} className="ui-section">
              <div className="ui-section__head"><h2 className="ui-section__title">{area.name}</h2><span className="ui-section__count">{areaLocations.length}件</span></div>
              <div className="ui-location-grid">
                {areaLocations.map((location) => (
                  <article key={location.id} className="ui-location-card">
                    <Link href={`/app/locations/${location.id}`}>
                      <div className="ui-location-card__media">
                        {location.imageUrl ? <Image src={location.imageUrl} alt={location.name} fill sizes="320px" className="object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-[var(--ink-muted)]">写真なし</div>}
                      </div>
                      <div className="ui-location-card__body">
                        <div className="ui-location-card__top">
                          <div className="min-w-0"><h3 className="ui-location-card__name">{location.name}</h3><p className="ui-location-card__meta">{location.type || "種類未設定"}</p></div>
                          {location.isPublic && <Badge tone="blue">公開ON</Badge>}
                        </div>
                        {location.memo && <p className="ui-item-card__memo">{location.memo}</p>}
                      </div>
                    </Link>
                    <div className="ui-location-card__actions">
                      <Link href={`/app/locations/${location.id}/edit`} className="ui-button ui-button--secondary">編集</Link>
                      <Link href={`/app/locations/${location.id}/qr`} className="ui-button ui-button--secondary">QR</Link>
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
          ))}
        </div>
      )}
    </div>
  );
}

