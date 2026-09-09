# なかみメモ

冷蔵庫・冷凍庫・食品棚・収納ボックス・防災備蓄箱などの中身を管理する、個人用Webアプリです。

業務用の厳密な在庫管理ではなく、家庭向けの「中身メモ + ゆるい在庫管理」を目的にしています。

## 主な機能

- Firebase Authentication によるログイン
- ユーザーごとのデータ分離
- エリア管理
- 保管場所管理
- アイテム管理
- 保管場所写真 1枚
- アイテム写真 1枚
- 期限管理
- 低在庫アラート
- アイテム検索
- 保管場所単位のQRコード
- ログイン不要の公開閲覧ページ
- Firestore Security Rules

## 技術スタック

- Next.js App Router
- TypeScript
- Tailwind CSS
- Firebase Authentication
- Cloud Firestore
- Supabase Storage（画像保存）
- Vercel デプロイ想定
- qrcode.react

## セットアップ

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local` に Firebase Web App と Supabase の設定値を入れてください。

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# 画像アップロード（サーバー側のみで使用。ブラウザには渡らない）
SUPABASE_URL=https://<プロジェクトRef>.supabase.co
SUPABASE_SECRET_KEY=
```

Firebase の値は Firebase Console の「プロジェクトの設定 > マイアプリ > Web アプリ」から取得します。

## 画像保存（Supabase Storage）

画像は Firebase Storage ではなく Supabase Storage に保存します。
アップロードはサーバー側の API ルート `POST /api/images/upload` 経由で行い、
`SUPABASE_SECRET_KEY` はブラウザに出しません。

- バケット名: `nakami-memo-images`（公開バケット。API 側で無ければ自動作成します）
- 保存パス: `users/{userId}/{items|locations}/{recordId}/image`
- 上限: 5 MB 未満 / JPEG・PNG・WebP・GIF

Supabase 側で必要な設定は次の2つです。

1. Supabase ダッシュボードの「Project Settings > Data API」から Project URL（`https://<プロジェクトRef>.supabase.co`）をコピーし、`SUPABASE_URL` に設定
2. 同じ画面の「API Keys」から service_role（secret）キーをコピーし、`SUPABASE_SECRET_KEY` に設定

`next.config.ts` の `images.remotePatterns` には、Supabaseのホスト名を直接書いています。
ホスト名は画像URLに元から露出している公開情報なので秘密ではなく、環境変数にすると
ビルド環境への設定漏れで画像が黙って表示されなくなるためです。
Supabaseプロジェクトを移す場合だけ、`next.config.ts` の `DEFAULT_SUPABASE_HOSTNAME` を書き換えるか、
`SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` で上書きしてください。

## Firebase側で必要な設定

Firebase Consoleで以下を有効化してください。

1. Authentication
   - Googleログイン
   - メール/パスワードログイン
2. Cloud Firestore

## 開発コマンド

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
```

## データ構造

```text
users/{userId}
users/{userId}/areas/{areaId}
users/{userId}/locations/{locationId}
users/{userId}/items/{itemId}
publicLocations/{publicToken}
```

## 公開閲覧の設計

公開ページは `users/{userId}` 配下のデータを直接読ませません。

公開ONの保管場所だけ、`publicLocations/{publicToken}` に以下の最小情報を複製します。

- アイテム名
- 数量
- 単位

公開ページでは、写真・メモ・期限・カテゴリ・状態メモは表示しません。

## Firebase Rules反映

```bash
firebase deploy --only firestore:rules
```

## 現時点の注意

- ブラウザ通知は通知予定日を保存するところまでの設計です。Push通知の完全実装は次フェーズ想定です。
- 公開閲覧は `publicLocations` に最小情報を複製する方式です。
- 買い物リスト、CSV/JSON出力、複数写真、ゴミ箱、移動履歴は後回しです。
