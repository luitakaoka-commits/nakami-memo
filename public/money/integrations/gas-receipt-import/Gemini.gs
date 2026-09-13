/**
 * レシート画像を Gemini に読ませて、明細つきのJSONにする。
 *
 * 自由文を正規表現で削るのではなく、responseSchema で形を強制している。
 * レシートは店ごとにレイアウトが違いすぎて、パターンマッチでは保守できないため。
 *
 * ここはネットワークとプロンプトだけを担当する。Firestoreへの保存は Code.gs 側。
 */

/** レシート1枚から取り出したい形。Gemini にこの通りのJSONを返させる。 */
function receiptResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      storeName: { type: 'STRING', description: '店名。読み取れなければ空文字' },
      purchasedAt: { type: 'STRING', description: '購入日。YYYY-MM-DD 形式。読み取れなければ空文字' },
      total: { type: 'NUMBER', description: '税込の合計金額（支払total）。円' },
      taxTotal: { type: 'NUMBER', description: '消費税の合計。読み取れなければ0' },
      paymentMethod: {
        type: 'STRING',
        enum: ['cash', 'card', 'emoney', 'unknown'],
        description: '支払方法。現金=cash、クレジット=card、電子マネー/QR=emoney'
      },
      confidence: { type: 'NUMBER', description: '読み取りの自信度 0.0〜1.0' },
      items: {
        type: 'ARRAY',
        description: '明細行。小計・合計・お預り・お釣り・ポイントは含めない',
        items: {
          type: 'OBJECT',
          properties: {
            rawName: { type: 'STRING', description: 'レシート上の表記そのまま。略字や半角カナも直さない' },
            quantity: { type: 'NUMBER', description: '数量。書かれていなければ1' },
            unit: { type: 'STRING', description: '単位。書かれていなければ空文字' },
            unitPrice: { type: 'NUMBER', description: '単価。書かれていなければ0' },
            amount: { type: 'NUMBER', description: 'その行の金額（税込）。値引き行はマイナス' },
            category: {
              type: 'STRING',
              enum: RECEIPT_CATEGORIES,
              description: '品目のカテゴリ。迷ったら「その他」'
            }
          },
          required: ['rawName', 'amount', 'category']
        }
      }
    },
    required: ['storeName', 'purchasedAt', 'total', 'items']
  };
}

/**
 * 読み取りの指示。
 *
 * 日本のレシート特有の落とし穴を先回りして潰している。
 * ここを削ると、小計や「お預り」が明細に混ざって金額が二重に数えられる。
 */
function receiptPrompt() {
  return [
    'これは日本のスーパーやドラッグストアのレシートの写真です。',
    '書かれている内容をそのままJSONにしてください。推測で補わないでください。',
    '',
    '守ってほしいこと:',
    '- 明細には「実際に買った品物の行」だけを入れる。',
    '  小計・合計・お預り・お釣り・ポイント・値引き後合計・消費税の行は明細に入れない。',
    '- 「-50」「値引」「割引」のような値引き行は、明細の1行として amount をマイナスで入れる。',
    '- 金額は税込の表示金額を使う。内税/外税の計算はしない。',
    '- 品名はレシート上の表記そのままにする。半角カナ・略字・記号を直さない（後で機械的に揃える）。',
    '- 数量が書かれていなければ 1、単価が書かれていなければ 0 にする。',
    '- 購入日は必ず YYYY-MM-DD にする。年が書かれていなければ、レシートの他の情報から補わず空文字にする。',
    '- 文字がかすれて読めない箇所は、それらしい値を作らずに空文字か0にして、confidence を下げる。',
    '',
    'カテゴリの選び方:',
    '- 食品: 生鮮・加工食品・冷凍食品・パン・菓子',
    '- 飲料: 水・お茶・ジュース・酒',
    '- 調味料: 醤油・味噌・油・スパイス・だし',
    '- 日用品: 洗剤・トイレットペーパー・ティッシュ・掃除用品',
    '- 消耗品: 電池・ラップ・ゴミ袋・文具',
    '- 外食: 店内飲食・弁当チェーンのイートイン',
    '- その他: 判断できないもの'
  ].join('\n');
}

/**
 * Gemini の応答をどう扱うか。
 *
 *   'ok'       … 読めた
 *   'retry'    … 今回は諦めて、写真はそのまま残し次回やり直す（無料枠切れ・一時障害・キーやモデルの設定ミス）
 *   'fallback' … この画像だけの問題。Drive OCR に回す
 *
 * 以前は失敗を全部 Drive OCR に回していた。2026-09-13 にモデルの提供終了（HTTP 404）が起きたとき、
 * そのまま本番で動いていたら、全部のレシートが「明細なし・合計0円」で取り込まれ、
 * 写真は取込済みに移されて Gemini で読み直す機会が失われていた。
 * 無料枠切れ（429）でも同じことが起きる。設定や枠の問題は、待てば直るので読み直す方を選ぶ。
 */
function classifyGeminiResponse(code, body) {
  if (code === 200) return 'ok';
  // キーの誤りは 400 で返る。画像の問題の 400 と区別する
  if (code === 400 && /API_KEY/.test(String(body))) return 'retry';
  if (code === 400) return 'fallback';
  return 'retry';
}

/** 「今回は Gemini が使えない」を表す例外。importReceipts はこれを受けたら、その回の取込を止める。 */
function geminiUnavailable(message) {
  var error = new Error(message);
  error.geminiUnavailable = true;
  return error;
}

/**
 * Gemini に画像を投げてJSONを受け取る。
 * キーが無いとき・この画像を読めなかったときは null を返し、呼び出し側で Drive OCR へ落とす。
 * 無料枠切れや設定ミスのときは geminiUnavailable を投げる（OCR に落とさない。理由は classifyGeminiResponse）。
 */
function parseReceiptWithGemini(blob, config) {
  if (!config.geminiApiKey) return null;

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + encodeURIComponent(config.geminiModel) + ':generateContent?key='
    + encodeURIComponent(config.geminiApiKey);

  var payload = {
    contents: [{
      role: 'user',
      parts: [
        { text: receiptPrompt() },
        { inline_data: { mime_type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) } }
      ]
    }],
    generationConfig: {
      // temperature は指定しない。Gemini 3 系は既定の 1.0 前提で調整されており、
      // 下げると繰り返しなど想定外の動きをすると公式が注意している。形は responseSchema で縛る。
      responseMimeType: 'application/json',
      responseSchema: receiptResponseSchema()
    }
  };

  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify(payload)
    });
  } catch (error) {
    throw geminiUnavailable('Gemini へ到達できません: ' + error);
  }

  var code = response.getResponseCode();
  var body = response.getContentText();
  var verdict = classifyGeminiResponse(code, body);
  if (verdict === 'retry') {
    throw geminiUnavailable('Gemini が使えません (HTTP ' + code + '): ' + body.slice(0, 300));
  }
  if (verdict === 'fallback') {
    Logger.log('Gemini がこの画像を受け付けませんでした (HTTP ' + code + '): ' + body.slice(0, 300));
    return null;
  }

  var text = extractGeminiText(body);
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    Logger.log('Gemini の返答をJSONとして読めません: ' + text.slice(0, 200));
    return null;
  }
}

/** Gemini の返答から本文テキストだけを取り出す。 */
function extractGeminiText(body) {
  var parsed;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    return '';
  }
  var candidates = parsed && parsed.candidates;
  if (!candidates || !candidates.length) return '';
  var parts = candidates[0].content && candidates[0].content.parts;
  if (!parts || !parts.length) return '';
  return parts.map(function (part) { return part.text || ''; }).join('');
}
