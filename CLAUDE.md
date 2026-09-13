# 3アプリ統合 — Claude Code 向け作業メモ

このファイルは Claude Code が毎回自動で読みます。作業を始める前に必ず目を通してください。
**書いてある内容は実際の状態より古い可能性があります。** 下の「状態の確認」を必ず先に走らせてください。

---

## 状態の確認（作業前に毎回）

```bash
# git は PATH に無い。GitHub Desktop 同梱のものを先に通す（PowerShell）
$env:Path = "C:\Users\humal\AppData\Local\GitHubDesktop\app-3.6.5\resources\app\git\cmd;" + $env:Path

git branch --show-current          # main か feature/three-app-suite か
git log --oneline -5
git status --porcelain             # 未コミットの有無
git rev-parse --short HEAD origin/main   # push済みかどうか

npm test
# money 199件 → 2026-09-14 時点（SW の VERSION 上げ忘れの検出を追加）
#       196件 → 2026-09-13 時点（外税の割り振り・部門コード・取込タイミングのテストを追加）
#       183件 → 2026-09-10 時点（名寄せ修正 + GAS取込のテスト）
#       158件 → GAS取込のテストが無い
#       155件 → 名寄せの修正も無い。古いコミットを見ている
# recipe 16件 / app-switcher 26件 / install 10件 / rules 5件 / migrate 7件 も同じコマンドで走る
# 「Cannot find package 'jsdom'」と出たら npm install が済んでいない
```

**テストの件数が、いま何が終わっているかを一番正確に教えてくれます。**

---

## 目的

「食費・日用品の無駄な出費を減らす」こと。

重要なのは、**無駄は買った瞬間には確定しない**という性質です。同じ198円のもやしでも、
使い切れば無駄ではなく、腐らせれば全額が無駄になります。だから支出の記録だけでは無駄は見えません。

必要なのは、①品目単位で記録する ②その後どうなったかを記録する ③繰り返しのパターンを見せる、の3つ。
**レシートOCRもレシピ生成も、この3点を支える手段であって目的ではありません。**

---

## 構成

| アプリ | 役割 | 実装 | Firebaseプロジェクト | パス |
|---|---|---|---|---|
| なかみメモ | モノの台帳 | Next.js 15 / React 19 / TS | `nakami-memo` | `/` （`src/`） |
| お金管理 | お金の台帳 | 素のHTML+JS（IIFE） | `cash-manege` | `/money/` （`public/money/`） |
| つくりおきノート | 料理の台帳 | 素のHTML+JS（ESM） | `recipe-a18e1` | `/recipe/` （`public/recipe/`） |

共通の切り替えバーは `public/shared/`。

GitHub: `luitakaoka-commits/nakami-memo` ／ Vercel: `nakami-memo.vercel.app`
3アプリを1つのVercelプロジェクトに同居させています。

**編集は `public/` 配下と `src/` 配下だけ。** `Documents/Codex/2026-07-17/.../財務管理アプリ再作成` と
`2026-08-26/.../献立アプリ比較` は保管用で、触りません。

設計の全体（なぜこの形か、データモデル、各 Phase の中身）は
`Documents/Codex/設計書/統合設計_レシート明細とレシピ生成.md` にあります。
ただし 2026-09-06 時点の文書なので、「なかみメモの rules は一括許可だから変更不要」の記述は古いです
（いまはホワイトリスト方式。`tools` / `recipes` / `consumptions` を含めて 2026-09-13 に公開済み）。

**`docs/IMPLEMENTATION_PLAN.md` の Phase 1〜8 は、なかみメモ単体を最初に作ったときの完了済みの計画です。**
このファイルの Phase 0〜4（統合）とは別物です。ユーザーが「フェーズ2から3」と言ったら**統合の方**です。

**push はユーザーが GitHub Desktop で行います。** コミットまで済ませて「pushしてください」と伝えてください。

---

## 守ってほしい作法

- 作業の前に**受け入れ条件**を決める（「テストが158件通る」のように検証可能な形で）
- **テストの期待値を書き換えて通すのは禁止。** 落ちたら実装を疑う
- ファイル全体を書き直さない。tool出力は途中で切れることがあり、全文の再入力はファイルを壊す
- 実機確認が要る変更は、Vercelプレビューで確認してからマージする

---

## 決めたこと（覆さないでください）

- **統合方式は「案2」** — 1つのVercelプロジェクトに3アプリを同居させる。
  Cloudflareへの移行は見送り（3アプリとも `onSnapshot` の上に建っており、D1にリアルタイム購読が無い。
  Firebase Auth に相当する消費者向け認証もCloudflareに無い）
- **画像はSupabase Storageに一本化** — Firebase Storageは2024年9月以降Blazeプラン必須で、
  3プロジェクトともSparkのまま有効化できない。カード登録を避けるためSupabaseを使う
- **レシートは全部撮る**（食費・日用品に絞らない）。ただし**ふりかえりで聞くのは食品・日用品だけ**
  （`outcomeTracked` でカテゴリ判定。5,000円以上はカテゴリ問わず対象）
- **ふりかえりは週1回・曜日固定**。3択（使った／まだある／捨てた）、1回10件まで、繰り越し可
- **品名の名寄せは3段階** — ①機械的正規化（自動）②別名辞書（操作から学習）③手動統合。
  **意味の判断を自動でやらない**。「牛乳」と「低脂肪乳」を同じにしてよいかは本人にしか決められない。
  逆に寄せすぎると粒度が粗くなって行動につながらない
- **レシートは記録ページ内のタブ**。ボトムナビは5項目のまま。口座はナビに残す
- **3アプリは「くらしノート」1つとしてインストールする**（2026-09-14）。manifest は `public/manifest.webmanifest`
  の1つだけで、3アプリのページはすべてそれを指す（`id: "/"`・`scope: "/"`。**id を変えると別アプリ扱いになり入れ直しが要る**）。
  起動は `/start.html` で、最後に切り替えバーを出したアプリへ移る（`public/shared/last-app.js`、初回はお金管理）。
  アイコンは3色のしおりのノート（`public/icons/kurashi-note.svg`。PNG は `node scripts/render-icons.mjs` で作る）。
  タブのアイコン（favicon）はアプリごとのまま。**インストールは全フェーズが終わってから**（ユーザー希望）
- **Phase 3・4 の進め方**（2026-09-14 ユーザー決定）
  - なかみメモの下のメニューの「少ない」を「レシピ」に置き換える（残り少ないものはホームに出ている）。調理器具の登録はレシピ画面の中から
  - AIが考えたレシピの保存先は**つくりおきノート**（設計書の「Phase 3 はなかみメモに保存」から変更）
  - Phase 4 は**案B：Firebase を1つにまとめる**。つくりおきノートへの保存が2アプリをまたぐため、
    **まとめる作業を Phase 3 の保存より先にやる**。寄せ先は **`cash-manege`**（2026-09-14 決定。お金管理とGAS取込を動かさずに済むため）
  - ユーザーは3アプリとも **Google でログイン**している（メール/パスワードは使っていない）

### Firebase を cash-manege にまとめる手順（2026-09-14 着手）

| # | 内容 | 状態 |
|---|---|---|
| 1 | `public/money/firestore.rules` に なかみメモ・つくりおきノートの分（`users/{uid}` と `publicLocations`）を足す | 済 |
| 2 | そのルールを cash-manege に公開する（ユーザー） | 待ち |
| 3 | 引っ越しページ `/migrate`（`public/migrate/`）を公開する | 済（push待ち） |
| 4 | ユーザーが引っ越しページで書き写し、件数の一致を確かめる | 待ち |
| 5 | なかみメモ（`src/lib/firebase/client.ts`、画像APIの apiKey）とつくりおきノート（`firebase-config.js`）の接続先を cash-manege に切り替える | 未着手 |
| 6 | ユーザーが3アプリでデータとログイン1回を確かめる | 未着手 |

- uid はプロジェクトごとに違うので、`users/{古いuid}` → `users/{新しいuid}` へ書き写す。ドキュメントIDは変えない。
  `publicLocations` は `ownerId` を新しい uid に書き換える
- **古いプロジェクトのデータは消さない**（戻せるように残す）。4〜5の間はなかみメモとつくりおきで編集しない
- Supabase の写真は URL がそのまま使える。新しい写真は新しい uid のパスに入り、古い写真の削除だけ効かなくなる（孤児が少し残る）
- `rules.test.mjs` がアプリの使うコレクション名とルールのホワイトリストを突き合わせる。ルールの文法は Console に貼るまで確かめられない

---

## 事故から学んだこと（同じ穴を踏まないために）

**rewrite で相対パスが壊れた。** `/money` を rewrite で配信するとブラウザ上のURLが `/money` のままになり、
HTML内の `styles.css` が `/money/styles.css` ではなく `/styles.css` に解決されて全部404になりました。
アプリが起動しないので「Firebase認証だけ失敗している」ように見え、切り分けに時間を使いました。
**ステータスコードだけ見て「配信できている」と判断したのが原因です。**
いまは redirect で `/money/index.html` にしています。末尾スラッシュの `/money/` は
`trailingSlash: false` が `/money` に戻して噛み合わないので使いません。

**Service Worker が隣のアプリを壊す。** お金管理のSWが後始末で `key !== CACHE` の全キャッシュを
消していました。別オリジンなら無害ですが、同居した瞬間につくりおきノートのキャッシュを壊します。
接頭辞 `okane-` で絞る形に修正済み。**この条件を元に戻さないでください。**

**`cache.addAll` は1件でも失敗すると Service Worker 全体が入りません。** 1件ずつ入れる形にしてあります。

**お金管理の Service Worker の VERSION を上げ忘れ、直したコードがスマホに届いていなかった。** `public/money/sw.js` は
キャッシュ優先なので、VERSION（と `?v=`）を上げない限り、一度開いた端末には古いファイルが出続けます。
22 のまま `finance-engine.js` を2回直していました（09-09 名寄せ、09-13 部門コード）。2026-09-14 に 23 へ上げ、
`tests/sw-version.test.js` が「中身が変わったのに VERSION が同じ」を検出するようにしました。落ちたら VERSION を上げて
`tests/sw-shell-hashes.json` に**行を足す**（既存の行を書き換えない）。
あわせて、この SW が `/money/` の外（`/shared/` や共通の manifest）までキャッシュ優先で抱えていたのをやめました。

**ルールはデプロイしないと効かない。** リポジトリの `firestore.rules` はただのファイルです。
Firebase Console で公開するまで反映されません。レシートが保存できなかった原因はこれでした。

**GitHub Desktop が別のクローンを開いていることがある。** 「45コミット遅れ」のような表示が出たら
別フォルダを見ています。`File → Add local repository` で正しいパスを追加してください。

**ブラウザ実測テストが長いあいだ誰にも動かされていなかった。** `tests/ui/run-ui-test.js` は chromium のパスが
特定の環境（`/opt/pw-browsers/chromium`）に固定されていて、どこで走らせても起動しませんでした。
パスを直したあとも、①「今日」が実行日のまま（期待値は 2026-09-02 前提）②Service Worker が本物の
`firebase-sync.js` をキャッシュから返し、テスト用スタブを素通りしてログイン画面に戻る、の2つで8項目が落ちていました。
**期待値は1つも書き換えず**にこの2つを直し、25項目すべて通っています（2026-09-11）。CIに入れたので、もう眠りません。

**2つの「Phase」を取り違えた。** このファイルが Git に入っておらず、Claude Code が作業用コピー（git worktree）で
動いたときに読まれなかったため、統合の Phase を知らないまま `docs/IMPLEMENTATION_PLAN.md` の Phase で話を進め、
不要なセットアップ手順をユーザーに渡してしまいました。2026-09-11 にこのファイルをリポジトリへ入れています。

---

## 検証のやり方（毎回これを通す）

```bash
npm test                 # money 199 / recipe 16 / app-switcher 26 / install 10 / rules 5 / migrate 7
npm run test:ui          # お金管理のブラウザ実測 27項目（初回だけ npx playwright install chromium）
npm run typecheck && npm run lint && npm run build

# サーバーを起動して配信チェック（27件）とインストールの確認（14件）
npm start &
BASE=http://127.0.0.1:3000 node public/shared/serving-check.mjs
BASE=http://127.0.0.1:3000 node public/shared/install-check.mjs
```

`install-check.mjs` の Service Worker まわりを手で見るときは `127.0.0.1` ではなく `localhost` で開くこと
（お金管理は https か localhost のときだけ SW を登録する）。

GitHub Actions（`.github/workflows/ci.yml`）が、`main` への push と PR のたびに上の全部を回します。

`serving-check.mjs` は、ステータスコードではなくブラウザと同じ手順でHTMLから相対URLを
解決して実際に取りに行きます。**デプロイ前に必ず走らせてください。**

`.env.local` が無い場合、ビルドにはダミーの環境変数で足ります（`.env.example` 参照）。
**空の値ではダメ**で、`auth/invalid-api-key` で prerender が落ちます。CIは Secrets が無ければ自動でダミーに落とします。
Vercelの本番/プレビューには本物の値が Production・Preview 両方に設定済みです。
Supabaseのホスト名は `next.config.ts` に直書きしてあるので、環境変数の設定漏れで画像が消えることはありません。

---

## 現在地（2026-09-11 確認）

- `main` に 2026-09-11 の作業（CI整備・ブラウザ実測テストの修復・このファイルの追加）までマージ済み。
  **`origin/main` より先行 → push待ち**（件数は書かない。すぐ古くなるので `git rev-list --count origin/main..main` で確かめる）
- 検証は全部通した：money 183 / recipe 16 / app-switcher 25 / ブラウザ実測 25 / tsc / eslint / next build / serving-check 17
  （2026-09-13 に GAS取込とレシートのテストを足して money 196。GitHub Actions は 09-13 の push で緑）
- `public/money/integrations/` に `gas-card-mail-import` と `gas-receipt-import` の両方がある
- アプリのコードで 2026-09-10 以降に変わったのは `finance-engine.js` の `normalizeItemName`（部門コードを剥がす、09-13）だけ。
  画面は変わっていない。ほかは GAS・テスト・CI・文書

### この環境の癖（毎回ひっかかるので先に書く）

- **PowerShell では `git` が PATH に無い。** GitHub Desktop 同梱のものを使う（Bash ツールからはそのまま使える）:
  `$env:Path = "C:\Users\humal\AppData\Local\GitHubDesktop\app-3.6.5\resources\app\git\cmd;" + $env:Path`
- **`node_modules` が古い・無い状態から始まることがある。** `npm install` を1回。
  jsdom と playwright は devDependencies に入れたので、`--no-save` での追加や `SHARED_DIR` の手指定はもう要らない。
- **Claude Code が git worktree（`.claude/worktrees/…`）で動くことがある。** そのときは本体フォルダにある
  Git 管理外のファイル（`.env.local` など）は見えない。**Git に入っていないものは無いものとして扱う。**
- `next build` は `next-env.d.ts` に1行足す。生成物なので `git checkout -- next-env.d.ts` で戻す。

### 完了していること

**Phase 0 — 監査と修正**：3アプリのコードを全部読み、見つかった不具合を修正済み。
なかみメモの「フィールドを空にしても消えない」（`cleanObject` の更新時の誤動作）、削除失敗の握りつぶし、
フックのエラーが誰にも届かない、Firestoreリスナー10本→3本、お金管理の `adjustment` の符号がエンジンと
正反対、JSTのUTCズレ、死んだコード約350行。

**Phase 0.5 — 同居と切り替え**：`public/money/` `public/recipe/` へ配置、`/money` `/recipe` へのリダイレクト、
3アプリ共通の切り替えバー。つくりおきノートの写真をSupabaseへ移行。

**Phase 1 — レシート明細の土台**：`receipts` / `receiptItems` をサブコレクションで実装、レシート入力、
ふりかえりモーダル、ムダ支出カード、品名の名寄せ。テスト89件→155件。

**実機確認済み（Vercelプレビューで全項目通過）**：レシート保存、「捨てた」→明細削除→ムダ支出が消える連鎖、
フィールドを空にして消える、つくりおきノートの写真登録（Supabase）、アプリ切り替え、削除失敗時のエラー表示、既存の計算。

**デプロイ済みのルール**：`cash-manege` プロジェクトのFirestoreルール（`receipts` / `receiptItems` / `itemAliases` を含む）。

---

## 残っていること

**やる順番は push → Phase 2 のセットアップ → Phase 3 の前提（ルール公開・Vercel の環境変数）→ Phase 3 の実装。**
push とルール公開は数分で終わります。Phase 2 は `dryRun()` の結果を見る時間が要ります。

### 1. push ★ユーザーの手作業

GitHub Desktop で `main` を push してください。

- `ffb6eba` 名寄せの穴の修正（`repeatedWasteRanking` が常に `resolveItemKey` を通る。155→158件）
- `a226dfa` `gas-receipt-import` の4ファイルを配置
- `9a31089` その純粋関数のテスト25件（158→183件）
- `d1c6508` README の `workspaceId` の取り方を修正
- 2026-09-11 の分：CIでテストを回す、ブラウザ実測テストの修復、このファイルをリポジトリに追加、
  GAS取込の `WORKSPACE_ID` の案内（README の表と `setup()` のログ）が「設定画面に出る」となっていた矛盾を修正
- それ以前の feature ブランチ3コミット

`main` への push は Vercel の本番デプロイになります。

~~1. 名寄せの穴の修正~~ → 2026-09-10 完了（`ffb6eba`）。
バグ有りの実装に一度戻して、追加した3件のうち2件が実際に落ちることを確認済み。
「意味の違うものは分かれたまま」の1件は寄せすぎの回帰ガードなので両方で通ります。

~~2. `main` へマージ~~ → 2026-09-10 完了。`--ff-only` で通りました。

~~3. GASファイルの配置~~ → 2026-09-10 完了（`a226dfa`）。
置き場所は `Downloads` ではなく **`Documents/Codex/Claude outputs/`** でした。
同じフォルダに `cash-manege_firestore.rules` もあり、リポジトリの
`public/money/firestore.rules` とハッシュ一致（=デプロイ済みのものと同じ）。

### Phase 2 — レシート取込の自動化（コードは完成、セットアップ待ち）

GAS + Gemini。**次の一歩は Apps Script にセットアップして `dryRun()` を1回走らせること。**
保存せずに読み取り結果だけログに出ます。

そこで見るのは3点。**小計や「お預り」が明細に混ざっていないか、値引き行がマイナスで入っているか、
カテゴリの振り分けが妥当か。** 外れていたら `Gemini.gs` の `receiptPrompt()` に1行足して直します。

必要なもの: Gemini APIキー（https://aistudio.google.com/apikey）と `workspaceId`
（**設定画面には出ません**。「あなたのメンバーID」は uid で別物。取り方は同フォルダの README）。
どちらもスクリプトプロパティに入れます。モデルは `GEMINI_MODEL` で差し替え可能（既定 `gemini-3.6-flash`）。

**2026-09-13 の初回 dryRun**：`gemini-2.5-flash` が HTTP 404（新規ユーザーには提供終了）で、Drive OCR に落ちていた。
公式の廃止予定表では「廃止日未定」だったので、**表を信じずに実際のエラー本文を見ること**。
既定を `gemini-3.6-flash` に変え、Gemini 3 系の注意に従って temperature 指定（0）を外した。
**Phase 3 の `/api/recipes/suggest` でも同じモデル名と temperature の扱いにすること。**

**2026-09-13 の3回目 dryRun（gemini-3.6-flash）で初めて Gemini が読めた。** 東急ストアのレシート1枚で、
店名・日付・合計 3,837円・消費税 294円・支払方法 card・明細15行・値引き行はマイナス、まで取れた。
ただし**外税のレシート**で、明細（税抜の印字）の合計 3,543円 + 消費税 294円 = 合計、となり要確認に落ちた。
アプリは明細の合計 = 合計金額を前提にしているので、GAS 側で消費税を明細へ金額比で割り振って税込にそろえる
`allocateExclusiveTax` を足した（外税で説明がつくときだけ動く。テスト 26〜31）。
残りの確認（小計・お預りの混入、カテゴリの妥当さ）は、1品1行の表を出すようにした dryRun の次の結果待ち。
値引き行が「その他」になる点は、ふりかえりに出ない（outcomeTracked=false）ので実害は小さいが、
カテゴリ別の支出がわずかにずれる。直すかは次の dryRun の全体を見て決める。

**4回目の dryRun（2026-09-13）で読み取りの3点確認は合格。** 小計・お預りの混入なし、値引きはマイナス、
カテゴリは15行とも妥当（切れた品名「Vマークオニオンサ」も食品に振れていた）。

**同日のユーザーの要望と決定:**

- **取込は「入れ終わってから5分後にまとめて」**。5分おきに見回り、最後の追加から5分たったら取り込む
  （`millisUntilQuiet`）。Gemini を呼ぶのは写真1枚につき1回で、見回りの間隔は無料枠に効かないとユーザーに説明済み。
  あわせて、取込済みなら呼ばない・3回失敗で「取込失敗」へ移す・枠切れや設定ミス（429/5xx/401/403/404/キーの400）では
  OCR に落とさずその回を止める、にした。**設計書の「無料枠切れは Drive OCR に落として止めない」を変えた**
  （404 の件で、そのまま動いていたら全レシートが明細なしで取込済みになっていたため）。
- **Web検索で正式な商品名を調べたい** → **2026-09-13 決定：今はやらない（案A）**。何枚か取り込んで、
  切れた品名のせいで実際にカテゴリを間違えるようなら改めて検討する。検討時の選択肢は
  B（検索なしで Gemini に読みやすい名前を推測させ、rawName と並べて表示。アプリ画面の変更が要る）と
  C（課金を有効にして検索）。Gemini の Google 検索グラウンディングは
  無料枠では使えず課金の有効化が要る（料金ページ 2026-09-13 確認：月5,000回まで無料、以降 $14/1,000回、ただし有料枠のみ）。
  課金を有効にすると読み取り自体も有料になる。無料の代案（検索なしで Gemini に読みやすい商品名を推測させる等）を提示した。
- **品名の先頭の部門コード**（`* 3271 農場物語無調整牛乳` の `* 3271`）を `normalizeItemName` で剥がすようにした。
  残ると店が変わるだけで別物に数えられ、手入力の品名とも寄らないため。rawName はそのまま（正規化はアプリ側、の方針どおり）。

**スクリプトプロパティは `WORKSPACE_ID` と `GEMINI_API_KEY` の2つだけにする。** 2回目の dryRun で、
`GEMINI_MODEL` に `gemini-2.5-flash` が入っていて既定の変更が効かなかった（README の表が全行入れる読み方を許していた）。

コードは `public/money/integrations/gas-receipt-import/` にあります（2026-09-10 配置）。
手順は同フォルダの `README.md`。純粋関数には `tests/gas-receipt.test.js`（35件）が付いています。

**`dryRun()` の結果がおかしかったら、まずこのテストを走らせてください。**
通るなら整形・検算は正しいので、原因は `Gemini.gs` の `receiptPrompt()` 側です。
テストは「読み取れた後の処理」しか見ていないので、そこの切り分けに使えます。

配置時に確認したのは次の4点です（**`setup()` と本番の `importReceipts()` はまだ動かしていません**。動かしたのは dryRun だけ）:

- 秘密情報は入っていない（`GEMINI_API_KEY` はスクリプトプロパティ読み）
- カテゴリ一覧・ふりかえり対象カテゴリ・5,000円の境界が `finance-engine.js` と一致
- `buildReceiptRecord` が作るフィールドが `firestore.rules` の `hasOnly` と完全一致（順序も）
- `source` は `gemini` / `drive-ocr`、`status` は `pending` / `needs_review` でルールの許可内

APIキーが無くても動きます。その場合は Drive OCR だけになり、明細は空・`needs_review` で入ります。

### Phase 3 — レシピ生成（なかみメモ）

`tools`（調理器具）と `recipes` を追加。`POST /api/recipes/suggest` で Gemini を呼ぶ。
期限が近い食材を必須制約にし、持っていない器具を使わせない。

**前提は2つとも済んでいます（2026-09-13 ユーザー確認）。**

- なかみメモ側のルール公開：リポジトリ直下の `firestore.rules`（サブコレクション名のホワイトリスト）を
  Firebase Console で公開済み。モノ一覧・編集・公開場所のQRリンクの3点も確認済み
- Gemini APIキー：Vercel の環境変数 `GEMINI_API_KEY` に Production・Preview の両方で登録済み
  （まだ使うコードが無いので再デプロイはしていない。Phase 3 の最初の push で自然に反映される）

以下はルール公開前に確認した内容（記録として残す）。

**公開しても既存データは読めなくなりません（2026-09-10 確認済み）。**
新ルールは `users/{uid}/` の下を `areas` `locations` `items` `tools` `recipes` `consumptions` に絞りますが、
`src/lib/firebase/refs.ts` が使っているのは `areas` / `locations` / `items` の3つだけで、
`src` 全体を `collection(db, "users"` / `doc(db, "users"` で検索しても他は出ません。
`publicLocations` は `users/` の外なので別の match ブロックが受けます。
公開後の確認は、モノ一覧が出る・1件編集できる・公開場所のQRリンクが開ける、の3つ。

APIキーはサーバー側（API Route）でだけ読むこと。`NEXT_PUBLIC_` を付けた名前で読むとブラウザに漏れます。

### Phase 4 — 輪を閉じる

Firebaseプロジェクトの統合（3つ→1つ）。これが済むまで、アプリを切り替えると
なかみメモだけログインを求められます（uidがプロジェクト単位のため。仕様であってバグではない）。
そのあと購入→在庫→廃棄→ムダ支出の双方向連携。
