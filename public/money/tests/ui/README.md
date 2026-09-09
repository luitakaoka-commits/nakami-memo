# 一括UIテスト

`run-ui-test.js` はブラウザ上でアプリを起動し、要件書12.2のチェックを一括で実行します。
Firebaseへは接続せず、`stub-firebase-sync.js` に差し替えて動かすため、本番データには一切触れません。

## 実行

```bash
npm install playwright        # 初回のみ
node tests/ui/run-ui-test.js
```

`APP_ROOT` を指定すると、別の場所にあるアプリを対象にできます（既定はリポジトリ直下）。

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
