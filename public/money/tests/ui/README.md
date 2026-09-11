# 一括UIテスト

`run-ui-test.js` はブラウザ上でアプリを起動し、要件書12.2のチェックを一括で実行します。
Firebaseへは接続せず、`stub-firebase-sync.js` に差し替えて動かすため、本番データには一切触れません。

## 実行

```bash
npx playwright install chromium # 初回のみ（playwright 自体は devDependencies に入っている）
node tests/ui/run-ui-test.js
```

`APP_ROOT` は配信の根で、既定は `public/`。`APP_PATH`（既定 `/money/index.html`）で開くページを選びます。
`index.html` が `../shared/app-switcher.css` を参照しているので、根を `public/money/` にすると
切り替えバーが404になります。本番と同じ `public/` を根にしてください。

リポジトリ直下からは `npm run test:ui` で同じものが走ります。CIでも毎回実行されます。

### 崩すと黙って落ちる前提が2つあります

- **「今日」を 2026-09-02 に固定しています。** `SEED_STATE` と期待値がこの日を前提に書かれているためです
  （理由はスクリプト冒頭の `TODAY` のコメント）。実行日のままにすると、家賃が判定期限の外に出る、
  記録ページの月がずれる、などで落ちます。
- **Service Worker を止めています。** 動かすと再読み込み後に本物の `firebase-sync.js` がキャッシュから返り、
  スタブを素通りしてログイン画面に戻ります。`page.route` は Service Worker 経由の取得を横取りできません。

以前はこの2つと、ブラウザの実行ファイルのパス（特定の環境の `/opt/pw-browsers/chromium` 固定）、
配信の根（`public/money/`）のせいで、どこで走らせても起動しないか8項目が落ちる状態でした。
2026-09-11 に直し、期待値は1つも書き換えずに25項目すべて通ることを確認しています。

## 結果

成功時はコンパクトなJSONだけを返します。

```json
{"checks":{"initial_render":"pass", ...},"console_errors":[],"failed_details":[]}
```

失敗したチェックだけが `failed_details` に理由付きで入ります。
全DOMや大量のスクリーンショットは取得しません。

## チェック内容

| チェック | 内容 |
| --- | --- |
| `initial_render` | 起動、schemaVersion 4 への移行、移行前バックアップ、旧カード取引の利用日の暫定値 |
| `spendable_amount` | 今使える金額が計算式と一致すること、貯金口座を含めないこと |
| `card_usage_not_double_counted` | カード引落を現金支出に含めず、未払いカード額として一度だけ控除すること |
| `cashflow_check` | 利用日で残高が動かず引落日に動くこと、残高推移が表示されること |
| `salary_payment_date` | 暦月集計、翌月15日支給、土曜の前営業日繰り上げ、勤務済み額と予定額の分離 |
| `shift_month_navigation` | 支給月の切り替えと、再描画しても現在月へ戻らないこと |
| `shift_delete_and_recalculate` | 削除確認と削除後の即時再計算 |
| `persistence` | localStorageへの反映と再読み込み後の復元 |
| `candidate_not_counted_before_approval` | 承認前の取込候補が2つの計算に影響しないこと |
| `duplicate_candidate_blocked` | 同一fingerprintに重複警告が出ること |
| `candidate_approved_to_transaction` | 承認で正式なカード取引へ変換されること |
| `card_payment_date_calculated` | 引落予定日の自動計算と休日の翌営業日繰り下げ |
| `raw_notification_not_persisted` | 通知本文・カード番号・認証コードを保存しないこと |
| `json_export_import` | 正規化の往復で件数・金額合計が変わらないこと |
| `mobile_overflow` | 360px幅で全ページが横スクロールしないこと |

## 注意

本番Firebaseへのデプロイはこのテストでは行いません。
`firebase hosting:channel:deploy` によるPreview確認のあと、ユーザー承認を得てから本番へ反映してください。

---

## レイアウト崩れの監査（`audit-layout.js`）

カードの余白・ビューポートからのはみ出し・横スクロールの発生を、全ページ分まとめて実測します。

```bash
node tests/ui/audit-layout.js
```

`seed.json` と `candidates.json`（このフォルダに置く）のデータで描画し、ページごとに次を報告します。

| 種別 | 内容 |
| --- | --- |
| `padding` | カードの端に文字が張り付いている（実効余白が8px未満） |
| `viewport` | 画面幅からはみ出している（横スクロール可能な親を持つものは除外） |
| `scroll` | 要素自身が横に溢れている |

`issues` が空であれば崩れなしです。320px / 360px / 390px で確認することを推奨します。
ビューポート幅はスクリプト冒頭の `viewport` を変更してください。

### 既知の設計

`.card` にはパディングが無く、`.hero-card` `.list-card-header` `.list-row` のように**バリアント側で余白を指定する**設計です。
新しくカードを追加するときは、必ず余白を持つクラスを併記してください。忘れると文字がカードの端に張り付きます。
