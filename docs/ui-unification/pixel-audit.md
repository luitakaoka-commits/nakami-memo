# デザインボード ピクセル監査（design-board.html）

基準：`proto-styles.css` / `proto-tokens.css`（実プロトタイプ）。余白スケールは 6/12/20/28px、角丸はシート20px／操作部品10px、書体は Kiwi Maru 400/500。
検証方法：CSSとマークアップの精査のみ。ヘッドレスChrome（/opt/meta-chromium/chrome）は管理ポリシー（WebGL domain policy）で単独起動できず、スクリーンショットによる裏取りはできなかった。
凡例：「現」は design-board.html の現在値、「案」は提案値。

## 確実なズレ（実測できる不一致）

### 1. 行の罫線の出方がモックごとに違う（影響：大）
- 場所：全モック / `.ledger-row:first-of-type`、`.check-row:first-of-type`、`.step:first-of-type`
- 現：`:first-of-type` で初行の `border-top` を消しているが、これは「その要素が親の最初の div のとき」しか効かない
  - ①「まず使うもの」シート：先頭が `.sheet-head`（div）のため初行にも罫線が出る
  - ① 3枚目のシート：見出しが無いため初行の罫線が消える（同じモック内で不揃い）
  - ②の各シート：見出しが無いため全シート初行の罫線が消える
  - ③「次に作る」シート：`.sheet-head` があるため `.check-row` 初行に罫線が出る
  - ④：材料の初行は罫線なし、作り方の初行は罫線あり（同じシート内で不揃い）
- 案：`:first-of-type` をやめ、`.sheet-head + .ledger-row, .sheet-head + .check-row, .recipe-sec + .step { border-top: 0; }` のように「見出しの直後の行」を明示して消す
- 理由：プロトタイプの `.check-row:first-of-type` は「シートの先頭＝行」という前提で成立していた。ボードが見出し（sheet-head）を足したことで前提が崩れている

### 2. ヘッダーと本文見出しで同じタイトルが二重に出る（影響：大）
- 場所：①②③ / `.app-header strong` と `.page-heading h3`
- 現：ヘッダーに「ホーム（15px）」、本文にも「ホーム（30px）」と同語が縦に重なる（②は「期限リスト」が二重）
- 案：ヘッダー側の `strong` を外し、プロトタイプどおり「メニューボタン＋右端のキャプション」だけにする
- 理由：プロトタイプの `.app-header` には画面名のテキストが無い。タイトルは本文の `.page-heading` が担う文法

### 3. グループ見出しの左位置がどこにも揃っていない（影響：中）
- 場所：② / `.group-title`
- 現：`margin: 18px 12px 6px`。左端は本文端（20px）＋12px＝32px の位置で、シートの端（20px）ともシート内テキスト（40px）とも一致しない。縦も、前のシートの下余白20px＋18px＝38px の間隔で、スケール外
- 案：`margin: 0 0 6px`。左端をシートの端に合わせ、縦間隔は前のシートの `margin-bottom: 20px` と見出し下の 6px で統一する。あわせて `.group-title:first-child { margin-top: 0; }` は現マークアップでは一度もマッチしない（②では `.page-heading` が先頭）ため削除
- 理由：この値はプロトタイプのサイドバー内メニュー見出し（`.menu-group-title`）の流用。サイドバーでは左右12pxが `.menu-link` のテキスト位置と揃っていたが、本文のリストでは揃う相手がいない

### 4. 明細行の縦位置合わせがプロトタイプと逆で、ボード内でも不揃い（影響：中）
- 場所：①②③ / `.ledger-row { align-items: center; }`、対して ④ / `.ing { align-items: baseline; }`
- 現：台帳行は中央合わせ、材料行はベースライン合わせ。プロトタイプの `.ledger > div` は `align-items: baseline`
- 案：`.ledger-row` を `baseline` に戻す（チップのない行・値だけの行はプロトタイプどおり）。チップを含む行で中央合わせが必要なら、その行だけに限定する
- 理由：品名（13px）と補助テキスト（12px）の2行ブロックと右側の値を、行ごとに違う基準で置くと、右列の座りがモックごとに変わる

### 5. チェック行とプライマリボタンの文字がプロトタイプより小さい（影響：中）
- 場所：①③ / `.check-row { font-size: 13px; }`、④ / `.primary-button { font-size: 14px; }`
- 現：チェック行 13px、ボタン 14px
- 案：どちらも 15px（プロトタイプは未指定＝本文の15pxを継承。`.check-count` 13px、`.check-row small` 12px はプロトタイプどおりで正しい）
- 理由：同じ「行の主ラベル」「主要ボタン」が、基準より2px／1px小さい

### 6. 値とチップの間の gap が 10px（影響：小）
- 場所：③ / `.ledger-row .r { gap: 10px; }`
- 案：`gap: 12px`
- 理由：モック内の flex の gap は他がすべて12px（`.app-header`、`.ledger-row`、`.check-row`、`.sheet-head`、`.step`、`.ing`）。10px の gap はプロトタイプにも無い値

### 7. レシピ内見出しの余白が上下ともスケール外（影響：小）
- 場所：④ / `.recipe-sec { margin: 16px 0 2px; }`
- 現：上の間隔は直前の行の下余白8px＋16px＝24px（「材料」は meta の 4px＋16px＝20px で、節ごとに違う）。下は 2px＋初行の余白8px＝10px
- 案：`margin: 12px 0 4px`。上の合計を20px、下の合計を12px に揃える
- 理由：16px・2px とも余白スケールに無く、節間の合計間隔（24px／20px／10px）が場所で変わる

### 8. 細部のマジックナンバー（影響：小）
- ①③ / `.amount small { margin-left: 4px; }` → `6px`（--space-xs）。単位（件・品）の前だけ 4px で、プロトタイプに対応値が無い
- 全モック / `.fab { width: 52px; height: 52px; bottom: calc(20px + 8px); }` → サイズ 52px はどのトークンにも無い。`bottom` は実質28px なので `var(--space-lg)` と書く。右の `20px` も `var(--space-md)` に置換できる

## 好みで判断が要るもの

- **台帳行に全行罫線がある**（①②③④ / `.ledger-row`、`.ing`、`.step` の `border-top`）：プロトタイプの `.ledger` は行間に罫線を引かない（罫線があるのは `.check-row` と合計行だけ）。ボードは全行に引いており均一ではあるが、基準からは外れている。「台帳らしい線」と取るか、プロトタイプに寄せて消すか
- **FAB の存在と影**（全モック / `.fab`）：プロトタイプに FAB は無く、影も使わない方針。監査メモの方針（FAB→プライマリボタン）とも異なるので、残すかどうか自体が判断事項
- **本文見出しの組み立て**（①②③ / `.page-heading`）：プロトタイプは横並び（`display:flex; justify-content:space-between`）、ボードは eyebrow＋大見出しの縦積み。手書き案の意図があるなら縦積みでよい
- **シート内見出しの格**（①③ / `.sheet-title` 12px・補助色）：プロトタイプの `.section-heading` は h2＝18px 前提。12px の小さな見出しに落とすのは階層の判断
- **ブランド色テキストのサイズ分散**：`.sheet-link` 12px、`.check-count` 13px、`.text-button` 13px、`.date-label` 14px。役割差とも言えるが、12px のリンクだけ一段小さい
- **グループ見出しの文字サイズ 11px**（② / `.group-title`）：プロトタイプのサイドバー値の流用。本文の小ラベルは 12px で揃っているので、本文では 12px に上げる案もある
- **clamp の vw 基準**：`.amount` や見出しの `clamp(…, 11.8vw, …)` はプロトタイプどおりだが、ボードを PC で開くと vw がブラウザ幅になり上限値（56px／30px）で固定される。実機の見え方とは異なる点に注意

## 参考：スケール外だがプロトタイプ由来（欠陥ではない）

次はプロトタイプ側の値そのもの、またはその複写なので直さない：
- `.eyebrow { margin-bottom: 4px; }`、`.amount { margin: 14px 0 10px; }`（プロトタイプと同値）
- `.app-header { padding: 8px 16px; }`、`.ledger-row { padding-block: 8px; }`、`.text-button { padding: 8px 0; }`、`.status { padding: 6px 10px; }`（プロトタイプの部品内余白）
- `.sheet-head { margin-bottom: 4px; }` と `.recipe-meta { margin-top: 4px; }` の 4px はスケール外だが、見出し→初行の合計は 4px＋8px＝12px で他の見出しリズムと一致している

## 参考：ボード枠（提示用レイヤー）の値

モック本体ではなく、ボードの外側の CSS。実害は小さいが、気になる場合は：
- `.mess .ev { font-size: 12.5px; }`：小数フォントサイズは描画が環境でぶれる → `12px`
- `.screen { border-radius: 27px; }`：`.phone` の角丸36px・内余白10px と同心にするなら 36−10＝26px → `26px`
- その他スケール外の値：`.board { padding: 36px 28px 44px; }`、`.summary { padding: 28px 32px; margin-bottom: 32px; }`、`.cols { gap: 32px; }`、`.mocks { gap: 36px; }`、`.foot { margin-top: 30px; }`、`.rules li { padding: 7px 0; }`、`.rules .dot { margin-top: 9px; }`、`.swatches { gap: 14px; margin-top: 14px; }`、`.swatches i { border-radius: 5px; }`、`.lead { margin-top: 8px; }`、`.kicker { margin-bottom: 4px; }`
- 未使用ルール：`.ledger-row .val small`（11px）は現マークアップに出現しない
