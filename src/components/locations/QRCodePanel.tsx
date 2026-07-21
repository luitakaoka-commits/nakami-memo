"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, QrCode } from "lucide-react";
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
  if (!location) return <p className="ui-error">保管場所が見つかりません。</p>;

  return (
    <div className="ui-qr-card">
      <div>
        <Badge tone={location.isPublic ? "blue" : "slate"}>{location.isPublic ? "公開URL" : "ログイン必須URL"}</Badge>
        <h1 className="mt-3 ui-page-title">{location.labelName || location.name}</h1>
      </div>

      <div className="ui-qr-box"><QrCode size={18} className="mx-auto mb-3 text-[var(--ink-muted)]" aria-hidden="true" /><QRCodeSVG value={targetUrl} size={240} includeMargin /></div>

      <div className="ui-url-box">{targetUrl}</div>

      {!location.isPublic && (
        <p className="ui-status-note">ログイン必須</p>
      )}

      <div className="ui-form-actions mt-5">
        <Link href={`/app/locations/${location.id}`} className="ui-button ui-button--secondary"><ArrowLeft size={16} strokeWidth={2} />戻る</Link>
        <Link href={`/app/locations/${location.id}/edit`} className="ui-button ui-button--primary">公開設定</Link>
      </div>
    </div>
  );
}

