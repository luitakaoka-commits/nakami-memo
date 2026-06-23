"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getLocation } from "@/lib/firebase/firestore";
import { useAuth } from "@/lib/hooks/useAuth";
import type { Location } from "@/lib/types/location";
import { makePrivateLocationUrl, makePublicLocationUrl } from "@/lib/utils/qr";
import { Badge } from "@/components/common/Badge";
import { LoadingState } from "@/components/common/LoadingState";

export function QRCodePanel() {
  const params = useParams<{ locationId: string }>();
  const { user } = useAuth();
  const [location, setLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !params.locationId) return;
    async function load() {
      if (!user || !params.locationId) return;
      setLocation(await getLocation(user.uid, params.locationId));
      setLoading(false);
    }
    load();
  }, [params.locationId, user]);

  const targetUrl = useMemo(() => {
    if (!location) return "";
    if (location.isPublic && location.publicToken) return makePublicLocationUrl(location.publicToken);
    return makePrivateLocationUrl(location.id);
  }, [location]);

  if (loading) return <LoadingState label="QRコードを準備中" />;
  if (!location) return <p className="rounded-2xl bg-white p-5 text-red-700">保管場所が見つかりません。</p>;

  return (
    <div className="mx-auto max-w-lg space-y-5 rounded-3xl bg-white p-6 text-center shadow-soft">
      <div>
        <Badge tone={location.isPublic ? "blue" : "slate"}>{location.isPublic ? "公開URL" : "ログイン必須URL"}</Badge>
        <h1 className="mt-3 text-2xl font-black text-slate-900">{location.labelName || location.name}</h1>
        <p className="mt-2 text-sm text-slate-500">ラベル用のQRコードです。印刷の細かい調整は次フェーズでOK。</p>
      </div>

      <div className="mx-auto inline-block rounded-3xl border border-slate-200 bg-white p-5">
        <QRCodeSVG value={targetUrl} size={240} includeMargin />
      </div>

      <div className="rounded-2xl bg-slate-50 p-3 text-left text-xs text-slate-600 break-all">{targetUrl}</div>

      {!location.isPublic && (
        <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
          公開閲覧OFFのため、読み取り後はログインが必要です。ログイン不要にしたい場合は保管場所編集で公開ONにしてください。
        </p>
      )}

      <Link href={`/app/locations/${location.id}/edit`} className="inline-flex rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">公開設定を編集</Link>
    </div>
  );
}
