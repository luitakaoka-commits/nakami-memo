const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

// 本番と同じく public/ を配信の根にする。index.html が ../shared/app-switcher.css を
// 参照しているため、public/money/ を根にすると切り替えバーが404になる。
const ROOT = process.env.APP_ROOT || path.join(__dirname, '..', '..', '..');
const APP_PATH = process.env.APP_PATH || '/money/index.html';
// テスト中の「今日」。SEED_STATE と期待値はこの日を前提に書かれている:
//   - 家賃（9/5）が判定期限（毎月14日締め → 9/14）の内側に入り、現金支出が 80,000 になる
//   - 初日の残高が口座残高 300,000 のまま（9/1 の仕送りより後、9/5 の家賃より前）
//   - 記録ページの既定の月が 2026年9月になる
// 実行日のままにすると、日付が進むたびに黙って落ちる。
const TODAY = '2026-09-02T09:00:00+09:00';
const STUB = fs.readFileSync(process.env.STUB_PATH || path.join(__dirname, 'stub-firebase-sync.js'), 'utf8');
const PORT = 8791;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const clean = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, clean === '/' ? 'index.html' : clean);
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const SEED_STATE = {
  schemaVersion: 3,
  mode: 'local',
  meta: { onboarded: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' },
  accounts: [
    { id: 'a1', name: '生活費口座', role: 'primary', currentBalance: 300000, includeInSpendable: true, reserveAmount: 0, isPrimary: true },
    { id: 'a2', name: '自由費口座', role: 'spending', currentBalance: 40000, includeInSpendable: true, reserveAmount: 0, isPrimary: false },
    { id: 'a3', name: '貯金口座', role: 'savings', currentBalance: 500000, includeInSpendable: false, reserveAmount: 0, isPrimary: false }
  ],
  cards: [{ id: 'c1', name: 'メインカード', accountId: 'a1', closingDay: 15, paymentDay: 10, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
  workEntries: [
    { id: 'w1', date: '2026-07-05', hours: 4, status: 'worked', hourlyRateOverride: 0, memo: '早番' },
    { id: 'w2', date: '2026-07-20', hours: 6, status: 'planned', hourlyRateOverride: 0, memo: '' },
    { id: 'w3', date: '2026-08-03', hours: 5, status: 'worked', hourlyRateOverride: 0, memo: '' }
  ],
  transactions: [
    // 旧データ: transactionDate なしのカード取引（移行で dueDate を暫定値にする）
    { id: 't1', kind: 'payment', amount: 30000, dueDate: '2026-09-10', status: 'planned', sourceAccountId: 'a1', cardId: 'c1', category: '生活費', memo: '旧カード利用', affectsForecast: true },
    // 新データ: 利用日と引落日が分かれているカード取引
    { id: 't2', kind: 'payment', amount: 50000, transactionDate: '2026-08-20', dueDate: '2026-10-13', status: 'planned', sourceAccountId: 'a1', cardId: 'c1', category: '生活費', memo: '新カード利用', affectsForecast: true },
    // 現金支出
    { id: 't3', kind: 'payment', amount: 80000, dueDate: '2026-09-05', status: 'planned', sourceAccountId: 'a1', cardId: '', category: '固定費', memo: '家賃', affectsForecast: true },
    { id: 't4', kind: 'income', amount: 50000, dueDate: '2026-09-01', status: 'planned', sourceAccountId: 'a1', cardId: '', category: '収入', memo: '仕送り', affectsForecast: true }
  ],
  recurringPlans: [],
  settings: {
    defenseLine: 150000, deadlineMode: 'legacy14', cashflowHorizonDays: 90, holidayOverrides: {},
    wage: { hourlyRate: 1200, closingDay: 0, paymentDay: 25, paymentMonthOffset: 1, includeForecastInSpendable: true }
  }
};

const checks = {};
const failures = [];
const consoleErrors = [];

function record(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { checks[name] = 'pass'; })
    .catch(error => { checks[name] = 'fail'; failures.push({ check: name, message: error.message }); });
}

function assert(condition, message) { if (!condition) throw new Error(message); }

// 前のチェックで開いたモーダルがクリックを遮らないように閉じる
const closeModals = page => page.evaluate(() => {
  document.querySelectorAll('.modal-backdrop').forEach(node => { node.hidden = true; });
});

(async () => {
  await new Promise(resolve => server.listen(PORT, resolve));
  // パスは指定しない。playwright が入れたブラウザを使う（場所を変えたいときは PLAYWRIGHT_BROWSERS_PATH）。
  const browser = await chromium.launch();
  // Service Worker は止める。動かすと再読み込み後に本物の firebase-sync.js がキャッシュから返り、
  // 下の page.route のスタブを素通りしてログイン画面に戻ってしまう（SW経由の取得は route で横取りできない）。
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();

  // 期待値（未払いカード額、残高推移、判定期限など）は seed の日付を基準に書いてあるので、
  // 実行日で答えが変わらないよう「今日」を固定する。ここを動かすと期待値も全部書き直しになる。
  await page.clock.setFixedTime(new Date(TODAY));

  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('dialog', dialog => dialog.accept());

  await page.route('**/firebase-sync.js*', route => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: STUB }));
  // リロード時に再シードしないよう、未設定のときだけ書き込む
  await page.addInitScript(seed => {
    if (!localStorage.getItem('yoryoku-finance-v2')) localStorage.setItem('yoryoku-finance-v2', JSON.stringify(seed));
    localStorage.setItem('yoryoku-cloud-user', 'test-user');
  }, SEED_STATE);

  await page.goto(`http://localhost:${PORT}${APP_PATH}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__YORYOKU__), null, { timeout: 10000 }).catch(() => {});

  await record('initial_render', async () => {
    assert(await page.isVisible('#app-shell'), 'app-shell が表示されていない');
    assert((await page.textContent('#page-title')).trim() === 'ホーム', 'ホームが表示されていない');
    const migrated = await page.evaluate(() => {
      const state = window.__YORYOKU__.getState();
      const oldCard = state.transactions.find(item => item.id === 't1');
      return { version: state.schemaVersion, txDate: oldCard.transactionDate, estimated: oldCard.dateEstimated, offset: state.cards[0].paymentMonthOffset };
    });
    assert(migrated.version === 6, `schemaVersion が 6 でない: ${migrated.version}`);
    assert(migrated.txDate === '2026-09-10', `旧カード取引の利用日が暫定値になっていない: ${migrated.txDate}`);
    assert(migrated.estimated === true, '旧カード取引に dateEstimated が立っていない');
    assert(migrated.offset === 1, 'カードの支払月オフセットが既定値になっていない');
    const backup = await page.evaluate(() => localStorage.getItem('yoryoku-finance-backup-pre-v6'));
    assert(Boolean(backup), '移行前バックアップが保存されていない');
  });

  await record('spendable_amount', async () => {
    const result = await page.evaluate(() => window.__YORYOKU__.spendableAmount());
    assert(typeof result.total === 'number', '今使える金額が数値でない');
    assert(result.deadline === '2026-09-14', `判定期限が想定と違う: ${result.deadline}`);
    // 現金 + 収入 + 給与 − 現金支出 − 未払いカード − 最低残高
    // 収入と支出は今日を基準に期限内のものだけが入るため、実行日に左右されないよう結果側の内訳で検算する
    const expected = 340000 + result.incomeTotal + result.salaryTotal - result.cashOutflow - 80000 - 150000;
    assert(result.total === expected, `今使える金額が式と一致しない: ${result.total} != ${expected}`);
    assert(result.unpaidCardTotal === 80000, `未払いカードが想定と違う: ${result.unpaidCardTotal}`);
    assert(result.cashAvailable === 340000, '貯金口座が現金に含まれている');
    const shown = await page.textContent('.hero-card h1');
    assert(shown.replace(/[^0-9-]/g, '').length > 0, 'ホームに金額が表示されていない');
  });

  await record('card_usage_not_double_counted', async () => {
    const result = await page.evaluate(() => window.__YORYOKU__.spendableAmount());
    assert(result.unpaidCardTotal === 80000, `未払いカード合計が想定と違う: ${result.unpaidCardTotal}`);
    assert(result.cashOutflow === 80000, `現金支出にカード引落が混ざっている: ${result.cashOutflow}`);
    assert(result.excludedCardDueTotal === 30000, `期限内カード引落の除外額が想定と違う: ${result.excludedCardDueTotal}`);
    assert(result.unpaidCardBeyondDeadline === 50000, `期限外引落分が想定と違う: ${result.unpaidCardBeyondDeadline}`);
  });

  await record('cashflow_check', async () => {
    const check = await page.evaluate(() => window.__YORYOKU__.cashflowCheck());
    assert(['ok', 'belowDefense', 'shortfall'].includes(check.verdict), '判定値が不正');
    // カードの利用日には残高が動かない（動くのは引落日だけ）
    const dueDay = check.timeline.find(day => day.date === '2026-10-13');
    assert(check.timeline[0].primaryBalance === 300000, `初日の残高が口座残高と一致しない: ${check.timeline[0].primaryBalance}`);
    if (dueDay) assert(dueDay.primaryBalance < check.timeline.find(d => d.date === '2026-10-12').primaryBalance, '引落日に残高が減っていない');
    await page.evaluate(() => window.__YORYOKU__.setPage('cashflow'));
    await page.waitForSelector('.timeline-table tbody tr');
    const rows = await page.$$eval('.timeline-table tbody tr', nodes => nodes.length);
    assert(rows > 0, '残高推移が表示されていない');
    assert((await page.textContent('#page-title')).trim() === '支払い能力チェック', 'ページタイトルが違う');
  });

  await record('salary_payment_date', async () => {
    const salary = await page.evaluate(() => window.FinanceEngine.calculateSalaryByPaymentMonth(
      window.__YORYOKU__.getState().workEntries, '2026-08', window.__YORYOKU__.getState().settings.wage));
    assert(salary.workMonth === '2026-07', `勤務月が違う: ${salary.workMonth}`);
    assert(salary.scheduledPaymentDate === '2026-08-15', '基本支給日が15日でない');
    assert(salary.paymentDate === '2026-08-14', `土曜の繰り上げができていない: ${salary.paymentDate}`);
    assert(salary.confirmedAmount === 4800 && salary.plannedAmount === 7200, '勤務済み額と予定額の分離が違う');
  });

  await record('shift_month_navigation', async () => {
    await page.evaluate(() => window.__YORYOKU__.setPage('shift'));
    await page.waitForSelector('#shift-month');
    await page.selectOption('#shift-month', '2026-08');
    await page.waitForTimeout(120);
    const julyRows = await page.$$eval('#page-container .work-list .work-row', nodes => nodes.length);
    assert(julyRows === 2, `2026-08支給（7月勤務）のシフト件数が違う: ${julyRows}`);
    await page.selectOption('#shift-month', '2026-09');
    await page.waitForTimeout(120);
    const augRows = await page.$$eval('#page-container .work-list .work-row', nodes => nodes.length);
    assert(augRows === 1, `2026-09支給（8月勤務）のシフト件数が違う: ${augRows}`);
    // 再描画しても選択した月が現在月へ戻らないこと
    await page.evaluate(() => window.__YORYOKU__.setPage('shift'));
    await page.waitForSelector('#shift-month');
    const selected = await page.inputValue('#shift-month');
    assert(selected === '2026-09', `表示月が自動で戻っている: ${selected}`);
  });

  await record('shift_delete_and_recalculate', async () => {
    await page.selectOption('#shift-month', '2026-08');
    await page.waitForTimeout(120);
    const before = await page.evaluate(() => window.FinanceEngine.calculateSalaryByPaymentMonth(
      window.__YORYOKU__.getState().workEntries, '2026-08', window.__YORYOKU__.getState().settings.wage).totalAmount);
    await page.click('#page-container .work-list .work-row:last-child .mini-button.danger');
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => window.FinanceEngine.calculateSalaryByPaymentMonth(
      window.__YORYOKU__.getState().workEntries, '2026-08', window.__YORYOKU__.getState().settings.wage).totalAmount);
    assert(after < before, `削除後に給与が再計算されていない: ${before} → ${after}`);
    const remaining = await page.$$eval('#page-container .work-list .work-row', nodes => nodes.length);
    assert(remaining === 1, `削除後の件数が違う: ${remaining}`);
  });

  await record('persistence', async () => {
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('yoryoku-finance-v2')).workEntries.length);
    assert(saved === 2, `localStorageに反映されていない: ${saved}`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__YORYOKU__), null, { timeout: 10000 });
    const reloaded = await page.evaluate(() => window.__YORYOKU__.getState().workEntries.length);
    assert(reloaded === 2, `再読み込み後に復元されていない: ${reloaded}`);
  });

  await record('candidate_not_counted_before_approval', async () => {
    const CANDIDATES = [
      { id: 'cand1', sourcePackage: 'jcb.co.jp', sourceLabel: 'JCB', detectedAt: '2026-08-24T10:00:00.000Z', usedDate: '2026-08-24', amount: 12000, cardHint: 'メインカード', merchant: 'ローソン', type: 'purchase', status: 'pending', fingerprint: 'fp-a', note: '' },
      { id: 'cand2', sourcePackage: 'rakuten-card.co.jp', sourceLabel: '楽天カード', detectedAt: '2026-08-24T10:05:00.000Z', usedDate: '2026-08-24', amount: 12000, cardHint: 'メインカード', type: 'purchase', status: 'pending', fingerprint: 'fp-a', note: '' },
      { id: 'cand3', sourcePackage: 'unknown', sourceLabel: '不明', detectedAt: '2026-08-23T09:00:00.000Z', usedDate: '', amount: 0, cardHint: '', type: 'unknown', status: 'needs_review', fingerprint: 'fp-b', note: '金額を読み取れませんでした。' }
    ];
    const before = await page.evaluate(() => ({ spendable: window.__YORYOKU__.spendableAmount().total, min: window.__YORYOKU__.cashflowCheck().minBalance }));
    await page.evaluate(items => window.__YORYOKU__.setImportCandidates(items), CANDIDATES);
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ({ spendable: window.__YORYOKU__.spendableAmount().total, min: window.__YORYOKU__.cashflowCheck().minBalance }));
    assert(before.spendable === after.spendable, '承認前の候補が今使える金額に反映されている');
    assert(before.min === after.min, '承認前の候補が支払い能力チェックに反映されている');
    await page.evaluate(() => window.__YORYOKU__.setPage('imports'));
    await page.waitForSelector('.candidate-row');
    const rows = await page.$$eval('.candidate-row', nodes => nodes.length);
    assert(rows === 3, `候補の表示件数が違う: ${rows}`);
  });

  await record('duplicate_candidate_blocked', async () => {
    const warned = await page.$$eval('.candidate-row', nodes =>
      nodes.filter(node => node.textContent.includes('重複の可能性')).length);
    assert(warned === 2, `重複警告の表示が想定と違う: ${warned}`);
  });

  await record('candidate_approved_to_transaction', async () => {
    const before = await page.evaluate(() => window.__YORYOKU__.getState().transactions.length);
    await page.evaluate(() => window.__YORYOKU__.acceptCandidate('cand1'));
    await page.waitForTimeout(300);
    const created = await page.evaluate(() => {
      const list = window.__YORYOKU__.getState().transactions;
      return list[list.length - 1];
    });
    const after = await page.evaluate(() => window.__YORYOKU__.getState().transactions.length);
    assert(after === before + 1, '正式取引が作られていない');
    assert(created.kind === 'payment', 'kindがpaymentでない');
    assert(created.status === 'planned', 'statusがplannedでない');
    assert(created.amount === 12000, '金額が違う');
    assert(created.transactionDate === '2026-08-24', `利用日が違う: ${created.transactionDate}`);
    assert(Boolean(created.cardId), 'カードが紐づいていない');
    assert(created.memo === 'ローソン', `利用先がメモに入っていない: ${created.memo}`);
    const spendableAfter = await page.evaluate(() => window.__YORYOKU__.spendableAmount().unpaidCardTotal);
    assert(spendableAfter >= 12000, '取り込み後に未払いカード額へ反映されていない');
  });

  await record('card_payment_date_calculated', async () => {
    const check = await page.evaluate(() => {
      const list = window.__YORYOKU__.getState().transactions;
      const created = list[list.length - 1];
      const card = window.__YORYOKU__.getState().cards.find(item => item.id === created.cardId);
      return {
        dueDate: created.dueDate,
        expected: window.FinanceEngine.calculateCardPaymentDate(created.transactionDate, card.closingDay, card.paymentDay, card.paymentMonthOffset ?? 1)
      };
    });
    assert(check.dueDate === check.expected, `引落予定日が自動計算と一致しない: ${check.dueDate} != ${check.expected}`);
    // 2026-08-24 利用・15日締め翌月10日払い → 2026-10-10(土)・10-12(スポーツの日) を飛ばして 10-13
    assert(check.dueDate === '2026-10-13', `休日繰り下げが効いていない: ${check.dueDate}`);
  });

  await record('raw_notification_not_persisted', async () => {
    const stripped = await page.evaluate(() => window.__YORYOKU__.stripCandidate({
      sourcePackage: 'x', detectedAt: 'y', amount: 1, type: 'purchase', status: 'pending', fingerprint: 'f',
      rawBody: '本文の全文', cardNumber: '1234-5678-9012-3456', authCode: '000000'
    }));
    assert(!('rawBody' in stripped), '本文が保存対象に含まれている');
    assert(!('cardNumber' in stripped), 'カード番号が保存対象に含まれている');
    assert(!('authCode' in stripped), '認証コードが保存対象に含まれている');
    const state = await page.evaluate(() => JSON.stringify(window.__YORYOKU__.getState()));
    assert(state.indexOf('本文の全文') === -1, '通知本文が状態に保存されている');
  });

  await record('json_export_import', async () => {
    const result = await page.evaluate(() => {
      const api = window.__YORYOKU__;
      const before = api.getState();
      const roundTrip = api.normalizeState(JSON.parse(JSON.stringify(before)));
      const sum = list => list.reduce((total, item) => total + Number(item.amount || 0), 0);
      return {
        accounts: [before.accounts.length, roundTrip.accounts.length],
        transactions: [before.transactions.length, roundTrip.transactions.length],
        workEntries: [before.workEntries.length, roundTrip.workEntries.length],
        cards: [before.cards.length, roundTrip.cards.length],
        amount: [sum(before.transactions), sum(roundTrip.transactions)],
        version: roundTrip.schemaVersion
      };
    });
    Object.keys(result).forEach(key => {
      if (Array.isArray(result[key])) assert(result[key][0] === result[key][1], `${key} が往復で変化した: ${result[key].join(' → ')}`);
    });
    assert(result.version === 6, 'schemaVersionが6でない');
  });

  await record('card_statement_supersedes_itemized', async () => {
    // 同じ請求サイクルに請求総額があるとき、取り込んだ明細は内数として計算から外れる
    const before = await page.evaluate(() => {
      const r = window.__YORYOKU__.spendableAmount();
      return { unpaid: r.unpaidCardTotal, total: r.total, suppressed: r.cardSuppressedTotal };
    });
    await page.evaluate(() => window.__YORYOKU__.setImportCandidates([
      { id: 'cand9', sourcePackage: 'jcb.co.jp', sourceLabel: 'JCB', detectedAt: '2026-08-24T10:00:00.000Z', usedDate: '2026-08-24', amount: 7777, cardHint: 'SMBC', merchant: 'テスト店', type: 'purchase', status: 'pending', fingerprint: 'fp-9', note: '' }
    ]));
    await page.waitForTimeout(120);
    await page.evaluate(() => window.__YORYOKU__.acceptCandidate('cand9'));
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => {
      const list = window.__YORYOKU__.getState().transactions;
      const created = list[list.length - 1];
      const r = window.__YORYOKU__.spendableAmount();
      return { unpaid: r.unpaidCardTotal, suppressed: r.cardSuppressedTotal, entryType: created.entryType, origin: created.origin, cardId: created.cardId };
    });
    assert(after.entryType === 'itemized', `取込は明細として登録される: ${after.entryType}`);
    assert(after.origin === 'mail-import', '取込元が記録される');
    assert(after.unpaid === before.unpaid, `請求総額があるサイクルでは未払い額が増えない: ${before.unpaid} → ${after.unpaid}`);
    assert(after.suppressed === before.suppressed + 7777, `内数として外した額が記録される: ${after.suppressed}`);
    await closeModals(page);
  });

  await record('future_spendable', async () => {
    await closeModals(page);
    await page.evaluate(() => window.__YORYOKU__.setPage('spendable'));
    await page.waitForSelector('[data-action="open-future"]');
    await page.click('[data-action="open-future"]');
    await page.waitForSelector('#future-modal:not([hidden])', { timeout: 5000 });
    await page.waitForTimeout(400);
    const shown = await page.$eval('.future-amount strong', el => el.textContent.trim());
    assert(/[0-9]/.test(shown), `将来の金額が表示されない: ${shown}`);
    const range = await page.evaluate(() => ({ s: document.querySelector('#future-start').value, e: document.querySelector('#future-end').value }));
    assert(range.s && range.e && range.e > range.s, `既定の期間が不正: ${JSON.stringify(range)}`);
    // プリセットで期間が変わる
    await page.click('[data-action="future-preset"][data-preset="monthAfter"]');
    await page.waitForTimeout(400);
    const moved = await page.evaluate(() => document.querySelector('#future-start').value);
    assert(moved > range.s, `再来月のプリセットで開始日が進まない: ${moved}`);
    // エンジンの結果と画面の整合
    const engineTotal = await page.evaluate(() => {
      const s = document.querySelector('#future-start').value;
      const e = document.querySelector('#future-end').value;
      return window.FinanceEngine.calculateFutureSpendable({ ...window.__YORYOKU__.buildEngineInput(), includeSalary: true }, { startDate: s, endDate: e }).total;
    });
    assert(typeof engineTotal === 'number', '将来試算が数値を返す');
    await page.click('[data-close-modal="future-modal"]');
    await page.waitForTimeout(200);
  });

  await record('settle_and_unsettle', async () => {
    await closeModals(page);
    await page.evaluate(() => window.__YORYOKU__.setPage('plans'));
    await page.waitForSelector('[data-action="settle-event"]');
    const id = await page.$eval('[data-action="settle-event"]', el => el.dataset.id);
    const before = await page.evaluate(() => window.__YORYOKU__.getState().accounts.find(a => a.id === 'a1').currentBalance);
    await page.click(`[data-action="settle-event"][data-id="${id}"]`);
    await page.waitForTimeout(400);
    const settled = await page.evaluate(t => {
      const item = window.__YORYOKU__.getState().transactions.find(x => x.id === t);
      return { status: item.status, balance: window.__YORYOKU__.getState().accounts.find(a => a.id === 'a1').currentBalance };
    }, id);
    assert(settled.status === 'settled', '確定できる');
    assert(settled.balance !== before, '確定で残高が動く');

    await page.evaluate(() => window.__YORYOKU__.setPage('records'));
    await page.waitForTimeout(250);
    await page.click(`[data-action="edit-event"][data-id="${id}"]`);
    await page.waitForSelector('#event-modal:not([hidden])');
    const wrapVisible = await page.evaluate(() => !document.querySelector('#event-status-wrap').hidden);
    assert(wrapVisible, '編集画面に状態の切り替えが出る');
    await page.selectOption('#event-status', 'planned');
    await page.click('#event-form button[type="submit"]');
    await page.waitForTimeout(500);
    const reverted = await page.evaluate(t => {
      const item = window.__YORYOKU__.getState().transactions.find(x => x.id === t);
      return { status: item.status, settledAt: item.settledAt, balance: window.__YORYOKU__.getState().accounts.find(a => a.id === 'a1').currentBalance };
    }, id);
    assert(reverted.status === 'planned', `未確定に戻せる: ${reverted.status}`);
    assert(reverted.settledAt === '', '確定日がクリアされる');
    assert(reverted.balance === before, `残高が元に戻る: ${before} → ${reverted.balance}`);
  });

  await record('statement_detail_expand', async () => {
    await closeModals(page);
    await page.setViewportSize({ width: 390, height: 844 });
    // 同じ請求サイクルに、総額1件とメール取込の明細2件を用意する
    const ids = await page.evaluate(() => {
      const api = window.__YORYOKU__;
      const state = api.getState();
      // 先行チェックが作った取込明細を取り除いてから検証用データを置く
      state.transactions = state.transactions.filter(item => !String(item.id).startsWith('dx-') && item.entryType !== 'itemized');
      const base = {
        kind: 'payment', sourceAccountId: 'a1', destinationAccountId: '', transferType: 'external',
        cardId: 'c1', status: 'planned', affectsForecast: true, lendingAmount: 0, absorbedBy: '',
        createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z'
      };
      state.transactions.push(
        { ...base, id: 'dx-st', amount: 20000, dueDate: '2026-10-13', transactionDate: '2026-10-13', entryType: 'statement', category: 'カード', memo: '9月分の請求' },
        { ...base, id: 'dx-old', amount: 279, dueDate: '2026-10-13', transactionDate: '2026-09-02', transactionAt: '2026-09-02T02:00:00.000Z', entryType: 'itemized', origin: 'mail-import', category: 'カード利用', memo: 'ローソン' },
        { ...base, id: 'dx-new', amount: 145, dueDate: '2026-10-13', transactionDate: '2026-09-04', transactionAt: '2026-09-04T09:30:00.000Z', entryType: 'itemized', origin: 'mail-import', category: 'カード利用', memo: 'セブン' }
      );
      api.setPage('plans');
      return ['dx-st', 'dx-old', 'dx-new'];
    });
    assert(ids.length === 3, '検証用データを作れなかった');
    await page.waitForTimeout(200);

    const toggle = page.locator('[data-action="toggle-details"][data-id="dx-st"]');
    assert(await toggle.count() === 1, '請求総額にタップできる明細バッジが出ていない');
    assert((await toggle.textContent()).includes('明細2件'), `明細の件数が出ていない: ${await toggle.textContent()}`);
    assert(await page.locator('.detail-panel').count() === 0, 'タップ前に明細が開いている');

    await toggle.click();
    await page.waitForSelector('.detail-panel');
    const rows = await page.evaluate(() => [...document.querySelectorAll('.detail-panel .detail-row')].map(row => ({
      when: row.querySelector('.detail-when').textContent.trim(),
      name: row.querySelector('.detail-name').textContent.trim(),
      amount: row.querySelector('.detail-amount').textContent.trim()
    })));
    assert(rows.length === 2, `明細が2件出ていない: ${rows.length}`);
    assert(rows[0].name.includes('セブン'), `新しい利用が上に来ていない: ${rows[0].name}`);
    assert(rows[1].name.includes('ローソン'), `古い利用が下に来ていない: ${rows[1].name}`);
    assert(rows[0].when === '9/4 18:30', `利用時刻が日本時間で出ていない: ${rows[0].when}`);
    assert(rows[1].when === '9/2 11:00', `利用時刻が日本時間で出ていない: ${rows[1].when}`);

    // 明細そのものは一覧に別行として並んでいる（未確定のあいだは閲覧できる）
    await toggle.click();
    await page.waitForTimeout(150);
    assert(await page.locator('.detail-panel').count() === 0, 'もう一度タップしても閉じない');
  });

  await record('statement_absorbs_details', async () => {
    await closeModals(page);
    const before = await page.evaluate(() => window.__YORYOKU__.getState().accounts.find(a => a.id === 'a1').currentBalance);
    await page.evaluate(() => window.__YORYOKU__.setPage('plans'));
    await page.waitForTimeout(150);
    await page.click('[data-action="settle-event"][data-id="dx-st"]');
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => {
      const state = window.__YORYOKU__.getState();
      const pick = id => state.transactions.find(item => item.id === id);
      return {
        statement: pick('dx-st').status,
        oldItem: { status: pick('dx-old').status, absorbedBy: pick('dx-old').absorbedBy },
        newItem: { status: pick('dx-new').status, absorbedBy: pick('dx-new').absorbedBy },
        balance: state.accounts.find(a => a.id === 'a1').currentBalance,
        unpaid: window.__YORYOKU__.spendableAmount().unpaidCardTotal
      };
    });
    assert(after.statement === 'settled', '総額が確定していない');
    assert(after.oldItem.status === 'absorbed' && after.oldItem.absorbedBy === 'dx-st', `明細が吸収されていない: ${JSON.stringify(after.oldItem)}`);
    assert(after.newItem.status === 'absorbed', `明細が吸収されていない: ${JSON.stringify(after.newItem)}`);
    assert(after.balance === before - 20000, `残高が総額の分だけ減っていない: ${before} → ${after.balance}`);

    // 記録画面でも、確定した総額から明細を展開できる
    await page.evaluate(() => window.__YORYOKU__.setPage('records'));
    await page.waitForTimeout(200);
    const listed = await page.evaluate(() => [...document.querySelectorAll('#page-container .list-row')].length);
    const absorbedRows = await page.evaluate(() => [...document.querySelectorAll('#page-container .list-row')]
      .filter(row => row.textContent.includes('セブン')).length);
    assert(listed > 0, '記録に行が出ていない');
    assert(absorbedRows === 0, '吸収済みの明細が一覧に別行として残っている');
    const toggle = page.locator('#page-container [data-action="toggle-details"][data-id="dx-st"]');
    assert(await toggle.count() === 1, '記録で総額をタップできない');
    await toggle.click();
    await page.waitForSelector('#page-container .detail-panel');
    const names = await page.evaluate(() => [...document.querySelectorAll('#page-container .detail-panel .detail-name')].map(node => node.textContent.trim()));
    assert(names.length === 2 && names[0].includes('セブン'), `記録の明細が新しい順に出ていない: ${JSON.stringify(names)}`);
  });

  await record('statement_release_on_unsettle', async () => {
    await closeModals(page);
    await page.evaluate(() => window.__YORYOKU__.setPage('records'));
    await page.waitForTimeout(150);
    await page.click('#page-container [data-action="edit-event"][data-id="dx-st"]');
    await page.waitForSelector('#event-modal:not([hidden])');
    await page.selectOption('#event-status', 'planned');
    await page.click('#event-form button[type="submit"]');
    await page.waitForTimeout(500);
    const released = await page.evaluate(() => {
      const state = window.__YORYOKU__.getState();
      const pick = id => state.transactions.find(item => item.id === id);
      return { statement: pick('dx-st').status, oldItem: pick('dx-old').status, absorbedBy: pick('dx-old').absorbedBy };
    });
    assert(released.statement === 'planned', '総額が未確定に戻っていない');
    assert(released.oldItem === 'planned', `吸収済みの明細が未確定に戻っていない: ${released.oldItem}`);
    assert(released.absorbedBy === '', '吸収の紐付けが残っている');
  });

  await record('records_charts', async () => {
    await closeModals(page);
    await page.evaluate(() => {
      const api = window.__YORYOKU__;
      const state = api.getState();
      state.transactions = state.transactions.filter(item => !String(item.id).startsWith('dx-'));
      const base = {
        kind: 'payment', sourceAccountId: 'a1', destinationAccountId: '', transferType: 'external',
        cardId: '', status: 'settled', affectsForecast: true, lendingAmount: 0, absorbedBy: '', entryType: '',
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', settledAt: '2026-09-01'
      };
      state.transactions.push(
        { ...base, id: 'cg-1', kind: 'income', amount: 82000, dueDate: '2026-09-15', category: '給与', memo: 'バイト代' },
        { ...base, id: 'cg-2', amount: 30000, dueDate: '2026-09-03', category: '固定費', memo: '家賃' },
        { ...base, id: 'cg-3', amount: 12000, dueDate: '2026-09-06', category: '食費', memo: 'スーパー' },
        { ...base, id: 'cg-4', kind: 'saving', amount: 20000, dueDate: '2026-09-08', destinationAccountId: 'a3', category: '貯金', memo: '今月の貯金' },
        { ...base, id: 'cg-5', amount: 99999, dueDate: '2026-08-20', category: '食費', memo: '先月の支出' }
      );
      api.setPage('records');
    });
    await page.waitForTimeout(250);

    const summary = await page.evaluate(() => [...document.querySelectorAll('#page-container .summary-strip .stat-card')]
      .map(card => ({ label: card.querySelector('span').textContent.trim(), value: card.querySelector('strong').textContent.trim() })));
    assert(summary.length === 3, `収支サマリーが3枚出ていない: ${summary.length}`);
    assert(summary[0].value.includes('82,000'), `収入が合っていない: ${summary[0].value}`);
    assert(summary[1].value.includes('42,000'), `支出が合っていない: ${summary[1].value}`);
    assert(summary[2].value.includes('40,000'), `差引が合っていない: ${summary[2].value}`);

    const donuts = await page.evaluate(() => document.querySelectorAll('#page-container .donut svg').length);
    assert(donuts === 2, `円グラフが2つ描かれていない: ${donuts}`);
    const arcs = await page.evaluate(() => document.querySelectorAll('#page-container .chart-card:first-child .donut-arc').length);
    assert(arcs === 2, `支出の内訳が2区分になっていない: ${arcs}`);

    // 凡例には必ず金額と割合が文字で出る（色だけに頼らない）
    const legend = await page.evaluate(() => [...document.querySelectorAll('#page-container .chart-card:first-child .legend-row')]
      .map(row => row.textContent.replace(/\s+/g, ' ').trim()));
    assert(legend.length === 2, `凡例が2行でない: ${JSON.stringify(legend)}`);
    assert(legend[0].includes('固定費') && legend[0].includes('30,000') && legend[0].includes('71%'), `凡例の内容が不足: ${legend[0]}`);

    // 貯蓄・投資は支出と別枠
    const extra = await page.evaluate(() => document.querySelector('#page-container .record-extra').textContent);
    assert(extra.includes('20,000'), `貯蓄・投資が別枠で出ていない: ${extra.slice(0, 80)}`);
    assert(!legend.some(row => row.includes('貯金')), '貯金が支出のグラフに混ざっている');
  });

  await record('records_period_filter', async () => {
    await closeModals(page);
    await page.click('#page-container [data-action="range-month"][data-step="-1"]');
    await page.waitForTimeout(200);
    const prev = await page.evaluate(() => document.querySelector('#page-container .range-month strong').textContent.trim());
    assert(prev === '2026年8月', `前の月に移動していない: ${prev}`);
    const augExpense = await page.evaluate(() => document.querySelectorAll('#page-container .summary-strip .stat-card')[1].querySelector('strong').textContent);
    assert(augExpense.includes('99,999'), `8月の支出が出ていない: ${augExpense}`);

    await page.click('#page-container [data-action="range-month"][data-step="1"]');
    await page.waitForTimeout(200);

    // 期間を指定して絞り込む
    await page.click('#page-container [data-action="range-mode"][data-mode="custom"]');
    await page.waitForSelector('#record-start');
    await page.fill('#record-start', '2026-09-01');
    await page.fill('#record-end', '2026-09-05');
    await page.waitForTimeout(300);
    const narrow = await page.evaluate(() => [...document.querySelectorAll('#page-container .summary-strip .stat-card')]
      .map(card => card.querySelector('strong').textContent.trim()));
    assert(narrow[0].includes('¥0'), `期間外の収入が残っている: ${narrow[0]}`);
    assert(narrow[1].includes('30,000'), `期間内の支出になっていない: ${narrow[1]}`);

    // 凡例をタップして一覧を絞り込む
    await page.click('#page-container [data-action="range-mode"][data-mode="month"]');
    await page.waitForTimeout(200);
    await page.click('#page-container .chart-card:first-child .legend-row');
    await page.waitForTimeout(200);
    const active = await page.evaluate(() => Boolean(document.querySelector('#page-container .active-filter')));
    assert(active, 'カテゴリの絞り込みが効いていない');
    const listed = await page.evaluate(() => [...document.querySelectorAll('#page-container .list-row .list-main strong')].map(node => node.textContent.trim()));
    assert(listed.length === 1 && listed[0] === '家賃', `絞り込み結果が想定と違う: ${JSON.stringify(listed)}`);
    await page.click('#page-container .active-filter [data-action="filter-category"]');
    await page.waitForTimeout(200);
    assert(!(await page.evaluate(() => Boolean(document.querySelector('#page-container .active-filter')))), '絞り込みを解除できない');
  });

  await record('entry_type_survives_reload', async () => {
    await closeModals(page);
    // 読み込みのたびに entryType/origin が落ちると、取込明細が請求総額に化けて相殺が壊れる
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('yoryoku-finance-v2'));
      state.transactions.push({
        id: 'rt-item', kind: 'payment', amount: 500, dueDate: '2026-10-13', transactionDate: '2026-09-02',
        transactionAt: '2026-09-02T02:00:00.000Z', status: 'planned', sourceAccountId: 'a1', cardId: 'c1',
        entryType: 'itemized', origin: 'mail-import', category: 'カード利用', memo: '再読込テスト', affectsForecast: true
      });
      localStorage.setItem('yoryoku-finance-v2', JSON.stringify(state));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__YORYOKU__), null, { timeout: 10000 });
    const kept = await page.evaluate(() => {
      const item = window.__YORYOKU__.getState().transactions.find(x => x.id === 'rt-item');
      return { entryType: item.entryType, origin: item.origin, at: item.transactionAt };
    });
    assert(kept.entryType === 'itemized', `再読込で明細が請求総額に変わった: ${kept.entryType}`);
    assert(kept.origin === 'mail-import', `取込元が消えた: ${kept.origin}`);
    assert(kept.at === '2026-09-02T02:00:00.000Z', `利用時刻が消えた: ${kept.at}`);
  });

  await record('legacy_absorb_migration', async () => {
    await closeModals(page);
    // v5以前の状態: 請求総額が確定済みなのに、同じサイクルの明細が未確定のまま残っている
    const legacy = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('yoryoku-finance-v2'));
      state.schemaVersion = 5;
      const base = {
        kind: 'payment', sourceAccountId: 'a1', destinationAccountId: '', transferType: 'external',
        cardId: 'c1', affectsForecast: true, lendingAmount: 0,
        createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z'
      };
      state.transactions = state.transactions.filter(item => item.entryType !== 'itemized');
      state.transactions.push(
        { ...base, id: 'lg-st', amount: 20000, dueDate: '2026-10-13', transactionDate: '2026-10-13', entryType: 'statement', status: 'settled', settledAt: '2026-10-13', category: 'カード', memo: '9月分の請求' },
        { ...base, id: 'lg-item', amount: 279, dueDate: '2026-10-13', transactionDate: '2026-09-02', entryType: 'itemized', origin: 'mail-import', status: 'planned', category: 'カード利用', memo: '取り残された明細' }
      );
      localStorage.setItem('yoryoku-finance-v2', JSON.stringify(state));
      localStorage.removeItem('yoryoku-finance-backup-pre-v6');
      return true;
    });
    assert(legacy, '移行前の状態を作れなかった');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__YORYOKU__), null, { timeout: 10000 });
    const after = await page.evaluate(() => {
      const state = window.__YORYOKU__.getState();
      const item = state.transactions.find(x => x.id === 'lg-item');
      return { version: state.schemaVersion, status: item.status, absorbedBy: item.absorbedBy };
    });
    assert(after.version === 6, `移行後のschemaVersionが6でない: ${after.version}`);
    assert(after.status === 'absorbed', `取り残された明細が吸収されていない: ${after.status}`);
    assert(after.absorbedBy === 'lg-st', `吸収元の総額が紐づいていない: ${after.absorbedBy}`);
  });

  await record('receipt_discount_survives_edit', async () => {
    // レシート取込は値引きをマイナスの行で作る。編集して保存しても 0 に丸めず、合計も狂わないこと（2026-09-14 の不具合）
    await closeModals(page);
    await page.evaluate(() => {
      const api = window.__YORYOKU__;
      window.__TEST_CALLS__ = [];
      api.setReceipts([{ id: 'rc1', storeName: 'テストストア', purchasedAt: '2026-09-02', total: 193, taxTotal: 0, paymentMethod: 'card', transactionId: '', source: 'gemini', status: 'pending', note: '', createdAt: '2026-09-02T00:00:00.000Z', createdBy: 'gas-receipt-import' }]);
      api.setReceiptItems([
        { id: 'rc1-001', receiptId: 'rc1', lineNo: 1, rawName: '* 3271 牛乳', name: '* 3271 牛乳', quantity: 1, unit: '', unitPrice: 0, amount: 280, category: '飲料', outcomeTracked: true, outcome: 'in_stock', outcomeAt: '', outcomeReason: '', wasteAmount: 0, note: '', createdAt: '2026-09-02T00:00:00.000Z' },
        { id: 'rc1-002', receiptId: 'rc1', lineNo: 2, rawName: '値引', name: '値引', quantity: 1, unit: '', unitPrice: 0, amount: -87, category: 'その他', outcomeTracked: false, outcome: 'in_stock', outcomeAt: '', outcomeReason: '', wasteAmount: 0, note: '', createdAt: '2026-09-02T00:00:00.000Z' }
      ]);
      api.openReceiptModal('rc1');
    });
    await page.waitForSelector('#receipt-modal:not([hidden])');
    const shownSum = await page.textContent('#receipt-line-sum');
    assert(/193/.test(shownSum), `編集画面の明細の合計が値引きを引いていない: ${shownSum}`);
    await page.click('#receipt-form button[type="submit"]');
    await page.waitForTimeout(300);
    const saved = await page.evaluate(() => (window.__TEST_CALLS__ || []).find(call => call.fn === 'saveReceipt'));
    assert(saved, '保存が呼ばれていない');
    const discount = saved.items.find(item => item.rawName === '値引');
    assert(discount && discount.amount === -87, `値引きが保存時に変わった: ${discount && discount.amount}`);
    assert(saved.receipt.status === 'pending', `合計が合っているのに要確認になった: ${saved.receipt.status}`);
  });

  await record('receipt_accept_button', async () => {
    await closeModals(page);
    await page.evaluate(() => { window.__YORYOKU__.setPage('records'); window.__YORYOKU__.setRecordTab('receipts'); });
    await page.waitForSelector('#page-container [data-action="accept-receipt"][data-id="rc1"]');
    await page.click('#page-container [data-action="accept-receipt"][data-id="rc1"]');
    await page.waitForTimeout(200);
    const call = await page.evaluate(() => (window.__TEST_CALLS__ || []).find(item => item.fn === 'updateReceiptStatus'));
    assert(call && call.id === 'rc1' && call.status === 'accepted', `確認済みにならない: ${JSON.stringify(call)}`);
    // 確認済みのレシートにはボタンを出さない
    await page.evaluate(() => {
      const api = window.__YORYOKU__;
      api.setReceipts([{ id: 'rc1', storeName: 'テストストア', purchasedAt: '2026-09-02', total: 193, taxTotal: 0, paymentMethod: 'card', transactionId: '', source: 'gemini', status: 'accepted', note: '', createdAt: '', createdBy: '' }]);
    });
    await page.waitForTimeout(150);
    assert(await page.locator('#page-container [data-action="accept-receipt"]').count() === 0, '確認済みなのにボタンが残っている');
  });

  await record('receipt_to_inventory', async () => {
    // レシートの明細を、なかみメモの在庫に入れる（2026-09-16）。表記がゆれていても在庫を増やさずにまとめる
    await closeModals(page);
    await page.evaluate(() => {
      const api = window.__YORYOKU__;
      window.__TEST_CALLS__ = [];
      api.setReceipts([{ id: 'rc2', storeName: 'テストストア', purchasedAt: '2026-09-02', total: 396, taxTotal: 0, paymentMethod: 'cash', transactionId: '', source: 'gemini', status: 'pending', note: '', createdAt: '', createdBy: '' }]);
      api.setReceiptItems([
        { id: 'rc2-001', receiptId: 'rc2', lineNo: 1, rawName: '* 3271 ﾓﾔｼ', name: '* 3271 ﾓﾔｼ', quantity: 2, unit: '袋', unitPrice: 99, amount: 198, category: '食品', outcomeTracked: true, outcome: 'in_stock', outcomeAt: '', outcomeReason: '', wasteAmount: 0, note: '', createdAt: '' },
        { id: 'rc2-002', receiptId: 'rc2', lineNo: 2, rawName: 'ティッシュ', name: 'ティッシュ', quantity: 1, unit: '箱', unitPrice: 198, amount: 198, category: '消耗品', outcomeTracked: true, outcome: 'in_stock', outcomeAt: '', outcomeReason: '', wasteAmount: 0, note: '', createdAt: '' },
        { id: 'rc2-003', receiptId: 'rc2', lineNo: 3, rawName: '電車代', name: '電車代', quantity: 1, unit: '', unitPrice: 200, amount: 200, category: '交通', outcomeTracked: false, outcome: 'in_stock', outcomeAt: '', outcomeReason: '', wasteAmount: 0, note: '', createdAt: '' }
      ]);
      api.setPage('records');
      api.setRecordTab('receipts');
    });
    await page.click('#page-container [data-action="add-to-inventory"][data-id="rc2"]');
    await page.waitForSelector('#inventory-location');

    const checked = await page.$$eval('[data-inventory-line]', nodes => nodes.filter(node => node.checked).map(node => node.dataset.inventoryLine));
    assert(JSON.stringify(checked) === JSON.stringify(['rc2-001', 'rc2-002']), `食べ物と日用品だけ選ばれる: ${checked}`);

    await page.selectOption('#inventory-location', 'loc-shelf');
    await page.click('[data-action="submit-inventory"]');
    await page.waitForTimeout(300);

    const call = await page.evaluate(() => (window.__TEST_CALLS__ || []).find(item => item.fn === 'addToInventory'));
    assert(call, '在庫に入れる処理が呼ばれていない');
    assert(call.plan.merges.length === 1 && call.plan.merges[0].itemId === 'inv-moyashi', `表記ゆれのもやしは既存の在庫へ: ${JSON.stringify(call.plan.merges)}`);
    assert(call.plan.merges[0].quantity === 3, `1袋 + 2袋: ${call.plan.merges[0].quantity}`);
    assert(call.plan.creates.length === 1 && call.plan.creates[0].name === 'ティッシュ', `新しい在庫: ${JSON.stringify(call.plan.creates)}`);
    assert(call.plan.creates[0].locationId === 'loc-shelf', '選んだ保管場所');
    assert(call.plan.creates[0].category === '日用品', `消耗品はなかみメモの日用品へ: ${call.plan.creates[0].category}`);
    assert(call.plan.creates[0].purchaseRef === 'rc2#2', `どのレシートの何行目か: ${call.plan.creates[0].purchaseRef}`);
    assert(await page.locator('#inventory-modal:not([hidden])').count() === 0, '入れたあとも画面が開いたまま');
  });

  await record('receipt_list_tabs', async () => {
    // 未確認と確認済みを別々の一覧に置く（2026-09-15）
    await closeModals(page);
    await page.evaluate(() => {
      const api = window.__YORYOKU__;
      const receipt = (id, storeName, status) => ({ id, storeName, purchasedAt: '2026-09-02', total: 100, taxTotal: 0, paymentMethod: 'cash', transactionId: '', source: 'gemini', status, note: '', createdAt: '', createdBy: '' });
      api.setReceipts([receipt('tab-p', '未確認ストア', 'pending'), receipt('tab-n', '要確認ストア', 'needs_review'), receipt('tab-a', '確認済みストア', 'accepted')]);
      api.setReceiptItems([]);
      api.setPage('records');
      api.setRecordTab('receipts');
    });
    await page.waitForSelector('#page-container [data-action="receipt-list-tab"]');
    const stores = () => page.$$eval('#page-container .receipt-row .candidate-head strong', nodes => nodes.map(node => node.textContent.trim()));
    const tabs = await page.$$eval('#page-container [data-action="receipt-list-tab"]', nodes => nodes.map(node => node.textContent.trim()));
    assert(JSON.stringify(tabs) === JSON.stringify(['未確認 2件', '確認済み 1件']), `タブが違う（無視が0件なら出さない）: ${tabs}`);
    const unchecked = await stores();
    assert(JSON.stringify(unchecked.sort()) === JSON.stringify(['未確認ストア', '要確認ストア'].sort()), `未確認の一覧に確認済みが混ざっている: ${unchecked}`);

    await page.click('#page-container [data-action="receipt-list-tab"][data-tab="checked"]');
    await page.waitForTimeout(150);
    const checked = await stores();
    assert(JSON.stringify(checked) === JSON.stringify(['確認済みストア']), `確認済みの一覧が違う: ${checked}`);
    assert(await page.locator('#page-container [data-action="accept-receipt"]').count() === 0, '確認済みの一覧に「確認済みにする」が出ている');

    // 確認済みにしたら未確認の一覧から消え、確認済みの側に移る
    await page.click('#page-container [data-action="receipt-list-tab"][data-tab="unchecked"]');
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const api = window.__YORYOKU__;
      const receipt = (id, storeName, status) => ({ id, storeName, purchasedAt: '2026-09-02', total: 100, taxTotal: 0, paymentMethod: 'cash', transactionId: '', source: 'gemini', status, note: '', createdAt: '', createdBy: '' });
      api.setReceipts([receipt('tab-p', '未確認ストア', 'accepted'), receipt('tab-n', '要確認ストア', 'needs_review'), receipt('tab-a', '確認済みストア', 'accepted')]);
    });
    await page.waitForTimeout(150);
    assert(JSON.stringify(await stores()) === JSON.stringify(['要確認ストア']), '確認済みにしたのに未確認の一覧に残っている');
    const moved = await page.$$eval('#page-container [data-action="receipt-list-tab"]', nodes => nodes.map(node => node.textContent.trim()));
    assert(JSON.stringify(moved) === JSON.stringify(['未確認 1件', '確認済み 2件']), `件数が移っていない: ${moved}`);
  });

  await record('receipt_discount_folded', async () => {
    // 値引き行は、すぐ上の商品にまとめて1つの品物として扱う（2026-09-15）。
    // 以前は「値引」も1品に数え、在庫にもでき、捨てたときのムダ支出は値引き前の額だった
    await closeModals(page);
    await page.evaluate(() => {
      const api = window.__YORYOKU__;
      window.__TEST_CALLS__ = [];
      const base = { receiptId: 'rc3', quantity: 1, unitPrice: 0, outcomeTracked: true, outcome: 'in_stock', outcomeAt: '', outcomeReason: '', wasteAmount: 0, note: '', createdAt: '' };
      api.setReceipts([{ id: 'rc3', storeName: '値引きストア', purchasedAt: '2026-09-02', total: 406, taxTotal: 0, paymentMethod: 'cash', transactionId: '', source: 'gemini', status: 'pending', note: '', createdAt: '', createdBy: '' }]);
      api.setReceiptItems([
        { ...base, id: 'rc3-001', lineNo: 1, rawName: 'もやし', name: 'もやし', unit: '袋', amount: 198, category: '食品' },
        { ...base, id: 'rc3-002', lineNo: 2, rawName: '値引', name: '値引', unit: '', amount: -50, category: '食品' },
        { ...base, id: 'rc3-003', lineNo: 3, rawName: '牛乳', name: '牛乳', unit: '本', amount: 258, category: '飲料' }
      ]);
      api.setPage('records');
      api.setRecordTab('receipts');
    });
    await page.waitForSelector('#page-container [data-action="toggle-receipt"][data-id="rc3"]');
    const summaryText = await page.textContent('#page-container .receipt-row .candidate-main');
    assert(summaryText.includes('2品（値引き1件を含む）'), `値引きが1品に数えられている: ${summaryText}`);
    assert(!summaryText.includes('合っていません'), '値引きをまとめたら合計が合わなくなった');

    await page.click('#page-container [data-action="toggle-receipt"][data-id="rc3"]');
    await page.waitForSelector('#page-container .receipt-line-view');
    const lineTexts = await page.$$eval('#page-container .receipt-line-view', nodes => nodes.map(node => node.textContent));
    assert(lineTexts.length === 2, `明細が値引きの行を含んだまま: ${lineTexts.length}件`);
    assert(lineTexts[0].includes('148') && lineTexts[0].includes('値引き'), `もやしが値引き後の額になっていない: ${lineTexts[0]}`);

    // 在庫に入れる画面に値引きの行は出ず、値引き後の値段で入る
    await page.click('#page-container [data-action="add-to-inventory"][data-id="rc3"]');
    await page.waitForSelector('#inventory-location');
    const listed = await page.$$eval('[data-inventory-line]', nodes => nodes.map(node => node.dataset.inventoryLine));
    assert(JSON.stringify(listed) === JSON.stringify(['rc3-001', 'rc3-003']), `在庫に入れる画面に値引きの行がある: ${listed}`);
    await page.click('[data-action="submit-inventory"]');
    await page.waitForTimeout(300);
    const call = await page.evaluate(() => (window.__TEST_CALLS__ || []).find(item => item.fn === 'addToInventory'));
    const rows = [...call.plan.creates, ...call.plan.merges];
    const moyashi = rows.find(row => (row.lineIds || []).includes('rc3-001'));
    assert(moyashi && moyashi.lineIds.includes('rc3-002'), `値引き行に在庫のIDを書き戻していない: ${JSON.stringify(moyashi)}`);
    assert(!rows.some(row => row.name === '値引'), '「値引」という在庫を作ろうとしている');
    const created = call.plan.creates.find(row => row.lineId === 'rc3-001');
    if (created) assert(created.purchasePrice === 148, `値引き後の値段になっていない: ${created.purchasePrice}`);

    // 捨てたら、ムダ支出は値引き後の額
    await closeModals(page);
    await page.evaluate(() => {
      const api = window.__YORYOKU__;
      const base = { receiptId: 'rc3', quantity: 1, unitPrice: 0, outcomeTracked: true, outcomeReason: '', wasteAmount: 0, note: '', createdAt: '' };
      api.setReceiptItems([
        { ...base, id: 'rc3-001', lineNo: 1, rawName: 'もやし', name: 'もやし', unit: '袋', amount: 198, category: '食品', outcome: 'expired', outcomeAt: '2026-09-02T01:00:00.000Z' },
        { ...base, id: 'rc3-002', lineNo: 2, rawName: '値引', name: '値引', unit: '', amount: -50, category: '食品', outcome: 'in_stock', outcomeAt: '' },
        { ...base, id: 'rc3-003', lineNo: 3, rawName: '牛乳', name: '牛乳', unit: '本', amount: 258, category: '飲料', outcome: 'in_stock', outcomeAt: '' }
      ]);
      api.setRecordTab('transactions');
    });
    await page.waitForSelector('#page-container .waste-card');
    const wasteText = await page.textContent('#page-container .waste-card .summary-strip');
    assert(wasteText.includes('148') && !wasteText.includes('198'), `ムダ支出が値引き前の額: ${wasteText}`);
  });

  await record('salary_record_flow', async () => {
    // 給与の見込みを「記録」の取引として持つ（2026-09-15）。
    // 以前は裏で足していたので直せず、給料日に実際の額が分かっても見込みが残り続けた。
    await closeModals(page);
    const before = await page.evaluate(() => {
      const state = window.__YORYOKU__.getState();
      const record = state.transactions.find(item => item.salaryPaymentMonth === '2026-09');
      return {
        record,
        balance: state.accounts.find(a => a.id === 'a1').currentBalance,
        virtualSeptember: window.__YORYOKU__.cashflowCheck().salaryEvents.filter(item => item.paymentMonth === '2026-09').length
      };
    });
    // seed: 8/3 に5時間（時給1,200円）→ 9/15 支給。今日は 9/2
    assert(before.record, '9月支給の給与が記録に作られていない');
    assert(before.record.status === 'planned' && before.record.amount === 6000, `見込みの中身が違う: ${JSON.stringify(before.record)}`);
    assert(before.record.dueDate === '2026-09-15' && before.record.category === '給与', `支給日かカテゴリが違う: ${JSON.stringify(before.record)}`);
    assert(before.virtualSeptember === 0, '記録があるのに裏の見込みも足している（二重計上）');

    // 記録の「未確定」に出る
    await page.evaluate(() => { window.__YORYOKU__.setPage('records'); window.__YORYOKU__.setRecordTab('transactions'); });
    await page.click('#page-container [data-record-filter="planned"]');
    await page.waitForTimeout(150);
    const listed = await page.locator(`#page-container [data-action="edit-event"][data-id="${before.record.id}"]`).count();
    assert(listed === 1, '記録の未確定に給与の見込みが出ていない（編集できない）');

    // シフト画面から、実際の額で確定する
    await page.evaluate(() => { window.__YORYOKU__.setPage('shift'); window.__YORYOKU__.setShiftMonth('2026-09'); });
    await page.waitForSelector('#page-container .salary-record-card');
    await page.click(`#page-container .salary-record-card [data-action="settle-event"][data-id="${before.record.id}"]`);
    await page.waitForSelector('#event-modal:not([hidden])');
    assert((await page.textContent('#event-modal-title')).trim() === '給与を確定', '確定用の画面になっていない');
    assert(await page.inputValue('#event-status') === 'settled', '状態が確定済みで開いていない');
    assert(await page.inputValue('#event-category') === '給与', `カテゴリが給与のまま開いていない: ${await page.inputValue('#event-category')}`);
    await page.fill('#event-amount', '5800');
    await page.click('#event-form button[type="submit"]');
    await page.waitForTimeout(250);

    const after = await page.evaluate(id => {
      const state = window.__YORYOKU__.getState();
      return {
        record: state.transactions.find(item => item.id === id),
        balance: state.accounts.find(a => a.id === 'a1').currentBalance
      };
    }, before.record.id);
    assert(after.record.status === 'settled' && after.record.amount === 5800, `確定額が入っていない: ${JSON.stringify(after.record)}`);
    assert(after.record.salaryManual === true, '確定したのに、シフトで上書きされうる状態のまま');
    assert(after.record.category === '給与', `編集でカテゴリが変わった: ${after.record.category}`);
    assert(after.record.memo === '2026年8月分の給与', `確定したのにメモが見込みのまま: ${after.record.memo}`);
    assert(after.balance === before.balance + 5800, `残高に確定額が入っていない: ${before.balance} → ${after.balance}`);

    // シフト画面にも確定額と見込みとの差が出る
    const card = await page.textContent('#page-container .salary-record-card');
    assert(card.includes('確定した支給額') && card.includes('5,800'), `シフト画面に確定額が出ていない: ${card}`);
    assert(card.includes('200') && card.includes('少ない'), `見込みとの差が出ていない: ${card}`);

    // 確定後にシフトを足しても、確定額は変わらない
    await page.evaluate(() => {
      const state = window.__YORYOKU__.getState();
      state.workEntries.push({ id: 'w-late', date: '2026-08-20', hours: 3, status: 'worked', hourlyRateOverride: 0, memo: '' });
      window.__YORYOKU__.syncSalaryRecords();
    });
    const kept = await page.evaluate(id => window.__YORYOKU__.getState().transactions.find(item => item.id === id).amount, before.record.id);
    assert(kept === 5800, `確定額がシフトで上書きされた: ${kept}`);

    // 記録から消した月は、作り直さず、計算にも戻ってこない
    await page.evaluate(() => {
      window.__YORYOKU__.getState().workEntries.push({ id: 'w-oct', date: '2026-09-10', hours: 4, status: 'planned', hourlyRateOverride: 0, memo: '' });
      window.__YORYOKU__.syncSalaryRecords();
      window.__YORYOKU__.setPage('records');
    });
    const october = await page.evaluate(() => window.__YORYOKU__.getState().transactions.find(item => item.salaryPaymentMonth === '2026-10'));
    assert(october && october.amount === 4800, `10月支給の見込みが作られていない: ${JSON.stringify(october)}`);
    await page.click(`#page-container [data-action="delete-event"][data-id="${october.id}"]`);
    await page.waitForTimeout(200);
    const dismissed = await page.evaluate(() => {
      const api = window.__YORYOKU__;
      const changed = api.syncSalaryRecords();
      const state = api.getState();
      return {
        changed,
        exists: state.transactions.some(item => item.salaryPaymentMonth === '2026-10'),
        months: state.settings.wage.dismissedSalaryMonths,
        virtual: api.cashflowCheck().salaryEvents.filter(item => item.paymentMonth === '2026-10').length
      };
    });
    assert(!dismissed.exists && !dismissed.changed, `消した見込みが作り直された: ${JSON.stringify(dismissed)}`);
    assert(dismissed.months.includes('2026-10'), '消した月を覚えていない');
    assert(dismissed.virtual === 0, '消した月の見込みが裏で足されている');
  });

  await record('mobile_overflow', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    const pages = ['home', 'spendable', 'cashflow', 'plans', 'records', 'accounts', 'shift', 'settings', 'imports'];
    const overflowing = [];
    for (const name of pages) {
      await page.evaluate(target => window.__YORYOKU__.setPage(target), name);
      await page.waitForTimeout(120);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      if (overflow.scrollWidth > overflow.clientWidth + 1) overflowing.push(`${name}(${overflow.scrollWidth}>${overflow.clientWidth})`);
    }
    assert(overflowing.length === 0, `横スクロールが発生: ${overflowing.join(', ')}`);
  });

  await browser.close();
  server.close();

  const output = { checks, console_errors: consoleErrors, failed_details: failures };
  console.log(JSON.stringify(output, null, failures.length || consoleErrors.length ? 2 : 0));
  process.exit(failures.length || consoleErrors.length ? 1 : 0);
})();
