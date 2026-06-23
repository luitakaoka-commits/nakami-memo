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
- Storage Rules

## 技術スタック

- Next.js App Router
- TypeScript
- Tailwind CSS
- Firebase Authentication
- Cloud Firestore
- Firebase Storage
- Firebase Hosting想定
- qrcode.react

## セットアップ

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local` に Firebase Web App の設定値を入れてください。

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

## Firebase側で必要な設定

Firebase Consoleで以下を有効化してください。

1. Authentication
   - Googleログイン
   - メール/パスワードログイン
2. Cloud Firestore
3. Firebase Storage
4. Firebase Hosting

## 開発コマンド

```bash
npm run dev
npm run typecheck
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
firebase deploy --only firestore:rules,storage
```

Hostingまでデプロイする場合は、Firebase HostingのNext.js対応設定に沿ってデプロイしてください。

## 現時点の注意

- ブラウザ通知は通知予定日を保存するところまでの設計です。Push通知の完全実装は次フェーズ想定です。
- 公開閲覧は `publicLocations` に最小情報を複製する方式です。
- 買い物リスト、CSV/JSON出力、複数写真、ゴミ箱、移動履歴は後回しです。
