"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Box, Pencil, Plus, QrCode } from "lucide-react";
import { deleteItem, getLocation } from "@/lib/firebase/firestore";
import { useAreas } from "@/lib/hooks/useAreas";
import { useAuth } from "@/lib/hooks/useAuth";
import { useItems } from "@/lib/hooks/useItems";
import type { Location } from "@/lib/types/location";
import { Badge } from "@/components/common/Badge";
import { ConfirmDeleteButton } from "@/components/common/ConfirmDeleteButton";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { ItemCard } from "@/components/items/ItemCard";

export function LocationDetail() {
  const params = useParams<{ locationId: string }>();
  const router = useRouter();
  const locationId = params.locationId;
  const { user } = useAuth();
  const { areas } = useAreas(user?.uid);
  const { items, loading: itemsLoading } = useItems(user?.uid, locationId);
  const [location, setLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || !locationId) return;
    async function load() {
      if (!user || !locationId) return;
      const result = await getLocation(user.uid, locationId);
      setLocation(result);
      setLoading(false);
    }
    load();
  }, [locationId, user]);

  const areaName = useMemo(() => areas.find((area) => area.id === location?.areaId)?.name ?? "未分類", [areas, location?.areaId]);

  if (loading || itemsLoading) return <LoadingState label="中身を読み込み中" />;
  if (!location) return <EmptyState title="保管場所が見つかりません" href="/app/locations" actionLabel="保管場所一覧へ" />;

  return (
    <div className="ui-stack-lg">
      <section className="ui-detail-card">
        <div className="ui-detail-card__media">
          {location.imageUrl ? <Image src={location.imageUrl} alt={location.name} fill sizes="(max-width: 820px) 100vw, 1180px" className="object-cover" /> : <div className="flex h-full items-center justify-center text-[var(--ink-muted)]"><Box size={34} strokeWidth={1.5} /></div>}
        </div>
        <div className="ui-detail-card__body">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="green">{areaName}</Badge>
                {location.type && <Badge>{location.type}</Badge>}
                {location.isPublic && <Badge tone="blue">公開ON</Badge>}
              </div>
              <h1 className="mt-3 ui-page-title">{location.name}</h1>
              {location.memo && <p className="ui-item-card__memo">{location.memo}</p>}
            </div>
            <div className="ui-page-head__actions">
              <Link href={`/app/items/new?locationId=${location.id}`} className="ui-button ui-button--primary"><Plus size={16} strokeWidth={2} />追加</Link>
              <Link href={`/app/locations/${location.id}/edit`} className="ui-button ui-button--secondary"><Pencil size={16} strokeWidth={2} />編集</Link>
              <Link href={`/app/locations/${location.id}/qr`} className="ui-button ui-button--secondary"><QrCode size={16} strokeWidth={2} />QR</Link>
            </div>
          </div>
        </div>
      </section>

      {error && <p role="alert" className="ui-error">{error}</p>}

      <section className="ui-section">
        <div className="ui-section__head"><h2 className="ui-section__title">中身一覧</h2><span className="ui-section__count">{items.length}件</span></div>

        {items.length === 0 ? (
          <EmptyState title="中身がありません" actionLabel="アイテムを追加" href={`/app/items/new?locationId=${location.id}`} />
        ) : (
          <div className="ui-list">
            {items.map((item) => (
              <div key={item.id} className="relative">
                <ItemCard item={item} />
                <div className="absolute bottom-3 right-3">
                  <ConfirmDeleteButton
                    label="削除"
                    message="このアイテムを削除しますか？"
                    onConfirm={async () => {
                      if (!user) return;
                      setError("");
                      try {
                        await deleteItem(user.uid, item.id);
                        router.refresh();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "削除できませんでした。");
                      }
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

