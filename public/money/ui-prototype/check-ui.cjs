/* Isolated UI checks; no production app or data connections. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = __dirname;
const output = 'C:/Users/humal/Documents/Codex/Codex outputs/お金管理アプリ再設計/UI指示用/手書き案の試作';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep) || !types[path.extname(file)] || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(process.env.PORT || 8799, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  if (process.argv.includes('--serve')) { console.log(base); return; }
  fs.mkdirSync(output, { recursive: true });
  let browser;
  const checks = {};
  const errors = [];
  const external = [];
  const test = async (name, condition) => { checks[name] = await condition() ? 'pass' : 'fail'; };
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (/firebase|firestore|googleapis.com\/(?!css)|gmail|identitytoolkit/.test(req.url())) external.push(req.url()); });
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    await test('initial_cashflow_balance_50000', async () => await page.locator('#cashflow-screen').isVisible() && await page.locator('#balance-content .amount').innerText() === '¥50,000');
    await test('kiwi_maru_loaded', () => page.evaluate(() => document.fonts.check('500 15px "Kiwi Maru"')));
    await test('bold_labels_500', () => page.locator('#page-title').evaluate(el => getComputedStyle(el).fontWeight === '500'));
    await test('forecast_hidden_on_cashflow', () => page.locator('#forecast-screen').isHidden());
    await page.screenshot({ path: path.join(output, '資金繰り_スマホ.png'), fullPage: true });
    await page.getByRole('button', { name: 'メニューを開く' }).click();
    await page.locator('#sidebar').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
    await test('sidebar_open', () => page.locator('#sidebar').evaluate(el => el.open && el.getBoundingClientRect().left === 0));
    await test('menu_13_routes', () => page.locator('.menu-link').count().then(n => n === 13));
    await test('menu_groups', () => page.locator('.menu-group-title').allTextContents().then(t => t.join(',') === 'メイン,サブ'));
    await page.screenshot({ path: path.join(output, 'サイドバー_スマホ.png') });
    await page.keyboard.press('Escape');
    await test('escape_closes_menu', () => page.locator('#sidebar').evaluate(el => !el.open));
    await test('focus_returns_to_menu', () => page.evaluate(() => document.activeElement.id === 'menu-open'));
    await page.getByRole('button', { name: 'メニューを開く' }).click();
    await page.mouse.click(375, 200);
    await test('backdrop_closes_menu', () => page.locator('#sidebar').evaluate(el => !el.open));
    await page.getByRole('button', { name: 'メニューを開く' }).click();
    await page.getByRole('button', { name: '予定', exact: true }).click();
    await test('plans_open_calendar', async () => await page.locator('.plan-calendar').isVisible() && (await page.locator('.plan-grid button').count()) === 30);
    await page.screenshot({ path: path.join(output, '予定_スマホ.png'), fullPage: true });
    await page.getByRole('button', { name: '翌月' }).click();
    await page.getByRole('button', { name: '12月5日、1件、収入1件' }).click();
    await test('calendar_selects_month_and_day', () => page.locator('#plans-screen .plan-row').innerText().then(t => t.includes('仕送り')));
    await page.getByRole('button', { name: '予定を追加', exact: true }).click();
    await page.locator('#plan-editor input[name="name"]').fill('検査用予定');
    await page.locator('#plan-editor input[name="amount"]').fill('1200');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await test('plan_save_updates_day_and_toast', async () => await page.getByText('検査用予定', { exact: true }).isVisible() && await page.locator('#toast.visible').textContent() === '保存しました');
    const openRoute = async label => { await page.getByRole('button', { name: 'メニューを開く' }).click(); await page.locator('.menu-link').filter({ hasText: label }).click(); };
    await openRoute('資金繰り・試算');
    await page.getByRole('button', { name: '口座残高 確認日 11/8 1口座 ›' }).click();
    await test('confirmation_opens_real_detail', () => page.locator('#detail-dialog').innerText().then(t => t.includes('¥180,000') && t.includes('11/8')));
    await page.getByRole('button', { name: '詳細を閉じる' }).click();
    await openRoute('資金繰り・試算');
    await test('cashflow_independent_route', () => page.evaluate(() => location.hash === '#cashflow' && !document.querySelector('#cashflow-screen').hidden && document.querySelector('#forecast-screen').hidden));
    await openRoute('支払いの見通し');
    await test('forecast_independent_route', () => page.evaluate(() => location.hash === '#forecast' && !document.querySelector('#forecast-screen').hidden && document.querySelector('#cashflow-screen').hidden));
    await test('forecast_menu_selected', () => page.locator('.menu-link[aria-current="page"]').innerText().then(t => t === '支払いの見通し'));
    await page.reload();
    await test('route_survives_reload', () => page.locator('#forecast-screen').isVisible());
    await test('planned_incomes_in_table', () => page.locator('tbody').innerText().then(t => t.includes('給与') && t.includes('仕送り') && t.includes('¥73,000')));
    await test('bar_chart_six_balances', () => page.locator('.chart-bar').count().then(n => n === 6));
    await test('zero_baseline_and_man_ticks', () => page.evaluate(() => document.querySelector('.chart-zero') && [...document.querySelectorAll('.chart-tick')].map(el => el.textContent).join(',') === '0円,5万円,10万円,15万円,20万円'));
    await test('positive_bars_blue', () => page.locator('.chart-bar.positive').evaluateAll(bars => bars.length === 6 && bars.every(bar => getComputedStyle(bar).fill === 'rgb(40, 115, 191)')));
    await test('forecast_no_playback', () => page.getByRole('button', { name: '再生', exact: true }).count().then(n => n === 0));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, '残高予測_スマホ.png'), fullPage: true });
    await page.keyboard.press('ArrowLeft');
    await test('arrow_does_not_change_route', () => page.evaluate(() => location.hash === '#forecast'));
    // Touch input via Chromium reproduces horizontal swipe without touching the user's browser.
    await page.evaluate(() => window.scrollTo(0, 0));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 340, y: 350 }] });
    for (const x of [285, 230, 175, 120, 65]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 350 }] });
      await page.waitForTimeout(30); // Gesture sampling, not a page-readiness delay.
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await test('swipe_does_not_change_route', () => page.evaluate(() => location.hash === '#forecast' && !document.querySelector('#forecast-screen').hidden));
    await openRoute('資金繰り・試算');
    const removed = ['口座残高を登録すると', '基準口座から、', '支払いを引いた残り', '引落後、いくら残る？', 'この表にない支払いは', '入金や請求額が変わると', '不明な金額を0円', '画面の移動はこのメニューから', '横スワイプは同じメニュー内だけ'];
    await test('requested_copy_removed', () => page.locator('body').textContent().then(text => removed.every(fragment => !text.includes(fragment))));
    await test('no_carousel_controls', () => page.locator('[data-slide], #carousel, #page-number').count().then(n => n === 0));
    await page.locator('summary').click();
    for (const [value, expected] of Object.entries({ shortfall: '−¥70,000', empty: '口座未登録', loading: '読込中', offline: 'オフライン', error: '読込エラー', success: '保存完了' })) {
      await page.locator('#preview-state').selectOption(value);
      await test('state_' + value, () => page.locator('#balance-content').innerText().then(t => t.includes(expected)));
      if (value === 'shortfall') {
        await openRoute('支払いの見通し');
        await test('negative_bars_red', () => page.locator('.chart-bar.negative').evaluateAll(bars => bars.length === 2 && bars.every(bar => getComputedStyle(bar).fill === 'rgb(197, 60, 69)')));
        await test('bars_extend_from_zero', () => page.evaluate(() => {
          const zero = Number(document.querySelector('.chart-zero').getAttribute('y1'));
          return [...document.querySelectorAll('.chart-bar')].every(bar => {
            const y = Number(bar.getAttribute('y')), height = Number(bar.getAttribute('height'));
            return bar.classList.contains('negative') ? Math.abs(y - zero) < .001 && height > 0 : Math.abs(y + height - zero) < .001 && y < zero;
          });
        }));
        await page.screenshot({ path: path.join(output, '残高予測_マイナス_スマホ.png'), fullPage: true });
        await openRoute('資金繰り・試算');
      }
    }
    await page.locator('#preview-state').selectOption('error');
    await page.locator('#balance-content [data-retry]').click();
    await test('retry_restores_data', () => page.locator('#balance-content .amount').innerText().then(t => t === '¥50,000'));
    await page.locator('summary').click();
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await test('no_overflow_' + width, () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('button', { name: 'メニューを開く' }).click();
      await test('sidebar_fits_' + width, () => page.locator('#sidebar').evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth));
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(output, '資金繰り_PC.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await openRoute('メール確認');
    const activeMail = () => page.locator('.mail-panel:not([inert])');
    await page.evaluate(() => window.scrollTo(0, 400));
    await test('menu_sticks_during_scroll', () => page.locator('.app-header').evaluate(el => scrollY > 100 && el.getBoundingClientRect().top === 0));
    await page.evaluate(() => window.scrollTo(0, 0));
    await test('mail_opens_pending_only', async () => await activeMail().getAttribute('aria-label') === '未取り込み' && await activeMail().locator('form').count() === 2);
    await page.screenshot({ path: path.join(output, 'メール_スマホ.png'), fullPage: true });
    async function swipeMailTo(index) {
      const track = await page.locator('.mail-track').boundingBox();
      const y = Math.round(track.y + 38);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 340, y }] });
      for (const x of [285, 230, 175, 120, 65]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        await page.waitForTimeout(30);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(i => {
        const strip = document.querySelector('.mail-track');
        return Math.abs(strip.scrollLeft - i * strip.clientWidth) < 2;
      }, index, { timeout: 3000 });
    }
    await swipeMailTo(1);
    await test('mail_swipe_opens_accepted', () => activeMail().innerText().then(t => t.includes('書店') && !t.includes('スーパー')));
    await swipeMailTo(2);
    await test('mail_ignored_only', () => activeMail().innerText().then(t => t.includes('コンビニ') && !t.includes('書店')));
    await openRoute('資金繰り・試算');
    await openRoute('メール確認');
    await test('mail_reopens_pending', () => activeMail().getAttribute('aria-label').then(t => t === '未取り込み'));
    const bill = activeMail().locator('[data-candidate="2"]');
    await bill.locator('select[name="card"]').selectOption('JCB W');
    await bill.getByRole('button', { name: '取り込む', exact: true }).click();
    await test('mail_requires_explicit_bill_type', async () =>
      await bill.isVisible() && await bill.locator('select[name="type"]').evaluate(select => select.validity.valueMissing));
    await activeMail().locator('[data-candidate="1"] input[name="amount"]').fill('2500');
    await activeMail().getByRole('button', { name: '取り込む', exact: true }).first().click();
    await test('mail_import_toast', () => page.locator('#toast.visible').textContent().then(t => t === '取り込みました'));
    await activeMail().getByRole('button', { name: '無視', exact: true }).click();
    await test('mail_pending_empty_after_actions', () => activeMail().innerText().then(t => t.trim() === '0件'));
    await page.getByRole('button', { name: '取り込み済み', exact: true }).click();
    await test('mail_accepted_keeps_edits', () => activeMail().innerText().then(t => t.includes('2,500') && t.includes('スーパー')));
    await page.locator('[data-mail-tab="2"]').click();
    await test('mail_ignore_moves_candidate', () => activeMail().innerText().then(t => t.includes('カード請求')));
    await openRoute('予定');
    await test('calendar_shows_income_and_expense', async () => {
      return await page.locator('[data-plan-day="2026-11-10"] .plan-mark.out').textContent() === '−' &&
        await page.locator('[data-plan-day="2026-11-13"] .plan-mark.in').textContent() === '+';
    });
    await test('calendar_has_no_filter_or_card_navigation', () => page.locator('#plan-filter, .detail-card-nav').count().then(n => n === 0));
    await page.getByRole('button', { name: '明細', exact: true }).click();
    const detail = () => page.locator('.detail-card-panel:not([inert])');
    await test('detail_period_filters_rows', async () => {
      await page.locator('#detail-period').selectOption('1');
      const older = await detail().innerText();
      await page.locator('#detail-period').selectOption('0');
      return older.includes('食品') && !older.includes('スーパー') && (await detail().innerText()).includes('スーパー');
    });
    const detailBox = await page.locator('.detail-track').boundingBox();
    const detailY = Math.round(detailBox.y + 45);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 340, y: detailY }] });
    for (const x of [285, 230, 175, 120, 65]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: detailY }] });
      await page.waitForTimeout(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('[data-detail-card="1"]').getAttribute('aria-pressed') === 'true');
    await test('detail_swipe_selects_card', () => detail().innerText().then(t => t.includes('書店')));
    await page.locator('.detail-card-nav').getByRole('button', { name: 'MUFG' }).click();
    await test('detail_bottom_navigation_selects_card', () => detail().innerText().then(t => t.includes('日用品')));
    await page.screenshot({ path: path.join(output, 'カード明細_スマホ.png'), fullPage: true });
    await openRoute('記録');
    await test('card_navigation_hidden_outside_details', () => page.locator('.detail-card-nav').isHidden());
    await page.getByRole('button', { name: '前月', exact: true }).click();
    await test('records_month_changes_history', () => page.locator('#records-screen').innerText().then(t => t.includes('10月の履歴') && t.includes('交通費')));
    await page.screenshot({ path: path.join(output, '記録_スマホ.png'), fullPage: true });
    await openRoute('口座・カード');
    await page.locator('#subaccounts summary').click();
    await test('subaccounts_and_cards', async () => await page.getByText('貯蓄口座', { exact: true }).isVisible() && await page.locator('.account-card').count() === 3);
    await page.screenshot({ path: path.join(output, '口座カード_スマホ.png'), fullPage: true });
    await openRoute('シフト・給与');
    await page.locator('[data-shift-day="2026-11-10"]').click();
    await page.locator('#shift-editor input[name="hours"]').fill('8');
    await page.locator('#shift-editor').getByRole('button', { name: '保存' }).click();
    await test('shift_calendar_edit_updates_totals', () => page.locator('.shift-totals').innerText().then(t => t.includes('20時間') && t.includes('25,000')));
    await page.screenshot({ path: path.join(output, 'シフト_スマホ.png'), fullPage: true });
    await page.locator('[data-shift-day="2026-11-10"]').click();
    const shiftForm = page.locator('#shift-editor form');
    await shiftForm.locator('[name="date"]').fill('2026-11-11');
    await shiftForm.locator('[name="status"]').selectOption('worked');
    await shiftForm.locator('[name="rate"]').fill('1500');
    await shiftForm.locator('[name="memo"]').fill('夕方シフト');
    await page.screenshot({ path: path.join(output, 'シフト編集_スマホ.png') });
    await shiftForm.getByRole('button', { name: '保存', exact: true }).click();
    const changedShift = page.locator('#shift-screen .plan-row').filter({ hasText: '夕方シフト' });
    await test('shift_edit_preserves_all_fields', async () =>
      (await changedShift.innerText()).includes('勤務済み · ¥1,500／時') &&
      (await page.locator('[data-shift-day="2026-11-10"]').innerText()).trim() === '10' &&
      (await page.locator('.shift-totals').innerText()).includes('27,000'));
    page.once('dialog', dialog => dialog.accept());
    await changedShift.getByRole('button', { name: '削除', exact: true }).click();
    await test('shift_delete_removes_shift_and_updates_pay', async () => await changedShift.count() === 0 && (await page.locator('.shift-totals').innerText()).includes('15,000'));
    await openRoute('口座・カード');
    await page.locator('[data-edit="account"][data-id="1"]').click();
    await page.locator('#asset-editor [name="balance"]').fill('181000');
    await page.locator('#asset-editor [name="verified"]').check();
    await page.locator('#asset-editor').getByRole('button', { name: '保存', exact: true }).click();
    await test('account_edit_updates_balance', () => page.locator('#accounts-screen').innerText().then(t => t.includes('181,000') && t.includes('銀行残高確認済み')));
    await page.locator('[data-delete="account"][data-id="1"]').click();
    await test('primary_account_delete_protected', () => page.locator('#toast.visible').textContent().then(t => t === '基準口座は削除できません'));
    await page.locator('[data-edit="card"][data-id="5"]').click();
    await page.locator('#asset-editor [name="payment"]').fill('12');
    await page.locator('#asset-editor').getByRole('button', { name: '保存', exact: true }).click();
    await test('card_edit_updates_payment_day', () => page.locator('#accounts-screen').innerText().then(t => t.includes('15日締め · 12日払い')));
    await page.locator('#subaccounts').evaluate(el => { el.open = true; });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-delete="account"][data-id="2"]').click();
    await test('unused_account_can_be_deleted', () => page.locator('#subaccounts').innerText().then(t => !t.includes('貯蓄口座')));
    await openRoute('記録');
    const record = page.locator('#records-screen .plan-row').filter({ hasText: '交通費' });
    await record.getByRole('button', { name: '編集', exact: true }).click();
    await page.locator('#plan-editor [name="amount"]').fill('4000');
    await page.locator('#plan-editor').getByRole('button', { name: '保存', exact: true }).click();
    await test('record_edit_refreshes_month_total', async () => (await record.innerText()).includes('4,000') && (await page.locator('.record-summary').innerText()).includes('74,000'));
    page.once('dialog', dialog => dialog.accept());
    await record.getByRole('button', { name: '削除', exact: true }).click();
    await test('record_delete_updates_history', () => record.count().then(n => n === 0));
    await openRoute('予定');
    await page.getByRole('button', { name: '明細', exact: true }).click();
    await page.locator('.detail-card-nav').getByRole('button', { name: 'JCB W', exact: true }).click();
    await test('absorbed_detail_protects_edit_and_delete', () => detail().locator('[data-edit-detail], [data-delete-detail]').count().then(n => n === 0));
    await page.locator('.detail-card-nav').getByRole('button', { name: '三井住友', exact: true }).click();
    await detail().getByRole('button', { name: '編集', exact: true }).click();
    await page.locator('#plan-editor [name="amount"]').fill('1300');
    await page.locator('#plan-editor').getByRole('button', { name: '保存', exact: true }).click();
    await test('detail_edit_updates_amount', () => detail().innerText().then(t => t.includes('1,300')));
    page.once('dialog', dialog => dialog.accept());
    await detail().getByRole('button', { name: '削除', exact: true }).click();
    await test('detail_delete_keeps_card_selection', () => detail().innerText().then(t => t.includes('三井住友') && t.includes('明細なし')));
    await test('no_private_data_connections', () => external.length === 0);
    await test('console_errors', () => errors.length === 0);
  } catch (error) { checks.execution = 'fail'; errors.push(error.stack); const pages = browser?.contexts()[0]?.pages(); if (pages?.[0]) { await pages[0].screenshot({ path: path.join(output, '失敗箇所.png') }); errors.push(JSON.stringify(await pages[0].evaluate(() => ({ scroll: scrollY, route: location.hash, hit: document.elementFromPoint(340, 350)?.outerHTML.slice(0, 200) })))); } }
  finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
  const result = { total: Object.keys(checks).length, passed: Object.values(checks).filter(v => v === 'pass').length, checks, console_errors: errors, failed_details: Object.entries(checks).filter(([, v]) => v !== 'pass').map(([key]) => key) };
  fs.writeFileSync(path.join(output, 'UI検査.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (result.failed_details.length) process.exitCode = 1;
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
