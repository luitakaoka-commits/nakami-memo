# GitHub Issue分割案

## Issue 1: 初期セットアップ

- Next.js App Router / TypeScript / Tailwind CSS を導入
- Firebase SDKを追加
- `.env.example` を作成
- 基本レイアウトを作成

## Issue 2: 認証

- Firebase Authentication を設定
- Googleログインを実装
- メール/パスワードログインを実装
- AuthGuardで `/app` 配下を保護

## Issue 3: エリアCRUD

- エリア作成・編集・削除
- 並び順
- 保管場所があるエリアの削除制御

## Issue 4: 保管場所CRUD

- 保管場所作成・編集・削除
- 種類、メモ、ラベル名、並び順
- 写真アップロード
- 中身がある保管場所の削除制御

## Issue 5: アイテムCRUD

- アイテム作成・編集・削除
- 数量、単位、状態メモ、カテゴリ
- 期限、通知予定日、低在庫しきい値
- 写真アップロード
- 別保管場所への移動

## Issue 6: ダッシュボード

- 検索バー
- 期限が近いもの
- 残り少ないもの
- エリア別保管場所一覧
- 最近追加したアイテム

## Issue 7: 検索・一覧

- 検索画面
- 期限一覧
- 低在庫一覧
- 名前順表示

## Issue 8: QRコード・公開閲覧

- QRコード表示画面
- 公開ON/OFF
- 公開用ランダムID
- 公開閲覧ページ
- 公開情報の最小化

## Issue 9: Firebase Rules / 仕上げ

- Firestore Rules
- Storage Rules
- README
- エラー表示
- ローディング表示
- 空状態
- スマホUI調整
