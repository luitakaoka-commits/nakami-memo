import type { Metadata } from "next";
import "./tokens.css";
import "./globals.css";
import { Providers } from "@/components/layout/Providers";
import { STALE_ASSET_RECOVERY } from "@/lib/utils/stale-asset-recovery";

export const metadata: Metadata = {
  title: {
    default: "なかみメモ",
    template: "%s | なかみメモ",
  },
  description: "家の在庫管理",
  applicationName: "なかみメモ",
  // 3アプリは「くらしノート」1つとしてインストールする。manifest と iPhone 用のアイコン・名前は3アプリ共通。
  // タブのアイコン（icon）はアプリごとのままにして、ブラウザで開いたときに見分けられるようにしている。
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/kurashi-note-apple-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "くらしノート",
    statusBarStyle: "default",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <head>
        {/* 新しい版を出したあと、前の版のページが CSS なしで出たら1回だけ読み込み直す（2026-09-28） */}
        <script dangerouslySetInnerHTML={{ __html: STALE_ASSET_RECOVERY }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

