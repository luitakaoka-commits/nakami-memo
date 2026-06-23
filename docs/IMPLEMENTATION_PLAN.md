# なかみメモ 実装計画

## 方針

「なかみメモ」は家庭向けの中身メモ + ゆるい在庫管理アプリとして実装する。業務用の厳密な在庫管理ではなく、スマホで素早く登録・確認できることを優先する。

## 技術スタック

- Next.js App Router
- TypeScript
- Tailwind CSS
- Firebase Authentication
- Cloud Firestore
- Firebase Storage
- Firebase Hosting
- qrcode.react

## フェーズ

### Phase 1: 初期セットアップ

- Next.js App Router 構成
- TypeScript strict
- Tailwind CSS
- Firebase SDK 初期化
- `.env.example`
- 基本レイアウト

### Phase 2: 認証

- Firebase Authentication
- Googleログイン
- メール/パスワードログイン
- AuthProvider
- AuthGuard
- `/app` 配下のアクセス制限

### Phase 3: エリア・保管場所管理

- エリアCRUD
- 保管場所CRUD
- 保管場所写真アップロード
- エリア別表示
- 手動並び順対応
- 中身がある保管場所の削除ブロック

### Phase 4: アイテム管理

- アイテムCRUD
- アイテム写真アップロード
- 数量、単位、状態メモ
- カテゴリ
- 期限、期限種類、通知予定日
- 低在庫しきい値
- 保管場所移動

### Phase 5: ダッシュボード

- 検索バー
- 期限が近いもの
- 残り少ないもの
- エリア別保管場所一覧
- 最近追加したアイテム

### Phase 6: 検索・一覧

- アイテム名、カテゴリ、メモ、保管場所名検索
- 期限一覧
- 低在庫一覧
- 名前順表示

### Phase 7: QRコード・公開閲覧

- 保管場所ごとのQR生成
- 公開ON/OFF
- 公開用ランダムID
- `/public/locations/[publicToken]`
- 公開画面ではアイテム名、数量、単位のみ表示

### Phase 8: ルール・仕上げ

- Firestore Security Rules
- Storage Rules
- README
- エラーハンドリング
- ローディング表示
- 空状態表示
- スマホUI調整

## 公開閲覧の安全設計

`users/{userId}/locations` や `users/{userId}/items` を未ログインに直接読ませない。代わりに `publicLocations/{publicToken}` に公開画面で表示してよい最小情報だけを複製する。

これにより、公開画面では以下以外が漏れない。

- アイテム名
- 数量
- 単位

写真、メモ、期限、カテゴリ、状態メモは公開ドキュメントに保存しない。
