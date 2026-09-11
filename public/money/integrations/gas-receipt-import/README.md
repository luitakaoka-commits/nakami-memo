# レシート写真の取込（Google Apps Script + Gemini）

Googleドライブの「レシート」フォルダに入れた写真を、15分おきに読み取って
Firestore の `receipts` / `receiptItems` に入れます。
アプリの「記録 → レシート」タブに `pending` または `needs_review` で現れるので、
そこで確認・修正して確定します。

**自動で正式データにはしません。** 必ず人の確認を1回挟みます。

## なぜこの形か

- **Firestoreへの書き込みに鍵を使いません。** `ScriptApp.getOAuthToken()` で
  ご自身のGoogleアカウントとして書きます。Apps Script と Firestore が同じGoogleの
  認証基盤に乗っているから成立しています。同じ理由で `gas-card-mail-import` も鍵なしです。
- **唯一の秘密情報は Gemini のAPIキー**で、スクリプトプロパティに置きます。
  リポジトリにも Firestore にも入りません。
- **二重取込が起きません。** ドキュメントIDを DriveのファイルID から決めているので、
  同じ写真を2回入れても1件しか作られません。

## 用意するもの

1. Gemini のAPIキー（[Google AI Studio](https://aistudio.google.com/apikey) で発行）
2. アプリの `workspaceId`

`workspaceId` は**設定画面には表示されません**。設定 → 共有 に出ている
「あなたのメンバーID」は uid であって別物なので、取り違えないでください。
取り方は次の2つです。

- **アプリから**：`/money` を開いて、ブラウザの開発者ツール（F12）のコンソールで
  ```js
  localStorage.getItem('okane-active-workspace')
  ```
  いま開いている共有スペースのIDが返ります。
- **Firebase Console から**：`cash-manege` → Firestore Database → `workspaces` コレクション。
  ドキュメントIDがそれです。複数あるときは `memberUids` に自分の uid が入っている方を選びます。

キーが無くても動きます。その場合は Drive OCR だけになり、店名・日付・合計を拾って
`needs_review` で登録します。明細は手で足すことになります。

## 手順

1. [script.google.com](https://script.google.com) で新しいプロジェクトを作る
2. `Code.gs` と `Gemini.gs` を貼り付ける（`appsscript.json` も「プロジェクトの設定 →
   appsscript.json をエディタで表示する」で置き換える）
3. **プロジェクトの設定 → スクリプト プロパティ** に追加する

   | プロパティ | 値 | 必須 |
   |---|---|---|
   | `WORKSPACE_ID` | 上の「用意するもの」の 2 で調べた値（設定画面には出ない） | ✅ |
   | `GEMINI_API_KEY` | AI Studio で発行したキー | 推奨 |
   | `FIRESTORE_PROJECT_ID` | 既定 `cash-manege` | |
   | `RECEIPT_FOLDER_NAME` | 既定 `レシート` | |
   | `GEMINI_MODEL` | 既定 `gemini-2.5-flash` | |

4. **サービス** から **Drive API** を追加する（Drive OCR のフォールバックに必要）
5. `setup()` を実行する。初回は権限の確認が出ます
6. ドライブに「レシート」フォルダができるので、写真を入れる

## スマホからの入れ方

カメラで撮る → 共有 → Google ドライブ →「レシート」フォルダ。3タップです。
アプリ内カメラを作るより手数が少なく、電波が無くても撮っておけます。

## モデルについて

`GEMINI_MODEL` は差し替えられます。既定の `gemini-2.5-flash` は画像入力と
structured output に対応していて、無料枠で十分回ります。
精度が足りなければ新しい世代（`gemini-3.5-flash` など）に、
無料枠を節約したければ `-lite` 系に、プロパティを1つ変えるだけで切り替えられます。

## 動きの確認

- `dryRun()` … 保存せずに1枚だけ読み取り結果をログに出します。プロンプトを調整するとき用
- `importReceipts()` … 手動で1回走らせます。実行ログに件数のサマリが出ます

## 取り込まれたあと

- 画像は「レシート/取込済み」に移動します。次回以降ダウンロードし直さないためです
- 読み取りに失敗した画像は動かしません。原因を直せば次回また拾います
- 明細の合計が合計金額と1円を超えてズレていたら `needs_review` になり、
  アプリ側に理由が出ます

## 保存しないもの

レシート画像そのもの（Driveに置いたまま）、カード番号の下4桁、ポイントカード番号。
`gas-card-mail-import` と同じ方針です。
