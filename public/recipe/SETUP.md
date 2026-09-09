# セットアップ手順

つくりおきノートを Firebase 上で動かすまでの手順です。所要時間はだいたい15〜20分。
料金は無料枠（Sparkプラン）の範囲で足ります。


## いまの状態（2026-08-26 時点）

プロジェクト `recipe-a18e1`（Sparkプラン・無料）について、次まで済んでいます。

- 済 `firebase-config.js` と `.firebaserc` に設定値を記入
- 済 Authentication で Google ログインを有効化
- 済 Cloud Firestore（(default) データベース）を作成
- 済 Firestore のセキュリティルールを公開（`users/{uid}` 配下は本人のみ、他は全拒否）
- 済 承認済みドメインに `localhost` / `recipe-a18e1.firebaseapp.com` / `recipe-a18e1.web.app`

残っているのは次の2つです。

1. **Hosting へのデプロイ** — 下の手順5。パソコンでコマンドを4つ実行する
2. **写真機能を使うなら Storage の有効化** — 下の「写真を使う場合」を参照

写真以外（レシピの登録・編集・削除、献立、買い物リスト、検索、同期、オフライン）は
デプロイすればそのまま動きます。

## 写真を使う場合（Storage）

このプロジェクトで Storage を有効にしようとすると、
「Storage を使用するには、プロジェクトの料金プランをアップグレードしてください」と表示されます。
現在の Cloud Storage for Firebase は、新規プロジェクトでは **Blaze プラン（従量課金）** が必要です。
Blaze はクレジットカードの登録が要りますが、無料枠（保存5GB・ダウンロード1GB/日）が
そのまま残るため、個人利用の範囲なら実際の請求は0円になることがほとんどです。
とはいえ課金設定なので、判断はご自身でお願いします。予算アラートを設定しておくと安心です。

Storage を有効にしない場合、アプリは写真以外を普通に保存し、写真を選んだときだけ
「写真の保存には Firebase Storage の有効化が必要です」と表示して、他の内容だけ保存します。

有効にする手順:
1. コンソール左下の「アップグレード」から Blaze プランに変更する
2. **構築 → Storage → 始める** → 「料金不要のロケーション」のまま「続行」→「本番環境モードで開始する」→「作成」
3. Storage の「ルール」タブを開き、`storage.rules` の中身を貼り付けて「公開」
   （または `firebase deploy --only storage:rules`）

---

## 1. Firebaseプロジェクトを作る

1. <https://console.firebase.google.com/> を開き、Googleアカウントでログインする
2. 「プロジェクトを追加」→ プロジェクト名（例 `tsukurioki-note`）→ 続行
3. Google アナリティクスは **オフ** で構わない → 「プロジェクトを作成」

作成後、画面上部に出る **プロジェクトID**（例 `tsukurioki-note-1a2b3`）を控えておく。

## 2. ウェブアプリを登録して設定値を取り出す

1. プロジェクトのトップで **`</>`（ウェブ）** アイコンをクリック
2. アプリのニックネーム（例 `web`）を入力。「Firebase Hosting も設定する」は**チェックしない**（後でCLIから行う）
3. 「アプリを登録」を押すと `firebaseConfig = { ... }` が表示される
4. その中身を `firebase-config.js` の `firebaseConfig` に貼り付ける

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "tsukurioki-note-1a2b3.firebaseapp.com",
  projectId: "tsukurioki-note-1a2b3",
  storageBucket: "tsukurioki-note-1a2b3.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef..."
};
export const useEmulators = false;
```

`.firebaserc` の `PASTE_PROJECT_ID` も、同じプロジェクトIDに書き換える。

> ここに書く値は公開されても問題ありません（クライアントを識別するためのもの）。
> データを守っているのは `firestore.rules` と `storage.rules` です。

## 3. Googleログインを有効にする

1. 左メニュー **構築 → Authentication** → 「始める」
2. 「Sign-in method」タブ → **Google** を選択 → 有効にする
3. プロジェクトの公開名とサポートメールを選んで保存
4. 「Settings」タブ →「承認済みドメイン」に、後で使うドメインが入っているか確認
   （`localhost` と `<プロジェクトID>.web.app` は自動で入る）

## 4. Firestore と Storage を作る

**Firestore**
1. 左メニュー **構築 → Firestore Database** → 「データベースの作成」
2. ロケーションは `asia-northeast1`（東京）を選ぶ
3. モードは「**本番環境モード**」でよい（この後ルールを上書きするため）

**Storage**
1. 左メニュー **構築 → Storage** → 「始める」
2. 同じく `asia-northeast1`
3. 本番環境モードで開始

> Storage の利用に請求先アカウントを求められることがあります。写真を使わないなら
> Storage を作らずに進めても、レシピの登録・献立・買い物リストは問題なく動きます
> （写真を選んだときだけエラーになります）。

## 5. ルールとアプリを配置する

このフォルダの **`deploy.cmd` をダブルクリック**すれば、下の4つをまとめてやってくれます。
（途中でブラウザが開くので、Googleアカウントで許可してください）

手で打つ場合は、このフォルダで PowerShell を開いて次を実行します。

```bash
npm install -g firebase-tools     # 初回のみ
firebase login                    # ブラウザが開くのでGoogleアカウントで許可
firebase use recipe-a18e1

firebase deploy --only firestore:rules,hosting
```

Storage を有効にした場合だけ、続けて `firebase deploy --only storage:rules` も実行します。
（Storage が未作成の状態でこれを実行するとエラーになります）

完了すると `https://recipe-a18e1.web.app` が表示されます。そこを開いて
「Googleでログイン」を押せば使い始められます。

デプロイせずに手元で確認したいときは **`preview.cmd` をダブルクリック**してください。
`http://localhost:8000` でアプリが開きます（`localhost` は承認済みドメインに入っています）。手で打つなら:

```bash
npx serve -l 8000        # または  python -m http.server 8000
```

## 6. スマホに入れる

- **Android / Chrome**：サイトを開いてメニュー →「アプリをインストール」
- **iPhone / Safari**：サイトを開いて共有ボタン →「ホーム画面に追加」

ホーム画面から開くとアドレスバーのない全画面で動き、電波がなくても起動します。

---

## 手元で試す（エミュレータ）

Firebaseに繋がず、パソコンの中だけで動作を確認できます。

```bash
# firebase-config.js を一時的に
#   projectId: "demo-tsukurioki", useEmulators: true
# にしてから
firebase emulators:start --project demo-tsukurioki
```

`http://127.0.0.1:5000` がアプリ、`http://127.0.0.1:4000` が管理画面です。
`demo-` で始まるプロジェクトIDを使うと、本物のFirebaseには一切通信しません。

---

## よくあるつまずき

| 症状 | 原因と対処 |
| --- | --- |
| 画面に「Firebaseの設定が必要です」と出る | `firebase-config.js` が `PASTE_...` のまま。手順2をやり直す |
| ログインで `auth/unauthorized-domain` | Authentication →「Settings」→「承認済みドメイン」に、開いているドメインを追加する |
| ログインのポップアップが出ない | ブラウザにブロックされている。アプリ側は自動でリダイレクト方式に切り替わるので、そのまま進めてよい |
| `Missing or insufficient permissions` | ルールが未反映。`firebase deploy --only firestore:rules,storage:rules` を実行する |
| 写真だけ保存できない | Storageが未作成、またはルールが未反映。手順4と5を確認する |
| 変更したのに古い画面が出る | Service Worker のキャッシュ。ページを再読み込みするか、`sw.js` の `VERSION` を上げてから再デプロイする |

## 費用について

個人利用の範囲（レシピ数百件・写真数百枚）なら無料枠に収まります。
Firestore は 1日あたり読み取り5万・書き込み2万まで、Storage は5GBまで無料です。
このアプリはコレクション全体を購読するため、レシピが増えると初回読み込みの
読み取り回数が増えます。数千件規模になったら、日付やカテゴリで絞る作りに
変えたほうがよくなります。
