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
    await test('initial_balance_50000', () => page.locator('.amount').innerText().then(t => t === '¥50,000'));
    await test('kiwi_maru_loaded', () => page.evaluate(() => document.fonts.check('500 15px "Kiwi Maru"')));
    await test('bold_labels_500', () => page.locator('#slide-title').evaluate(el => getComputedStyle(el).fontWeight === '500'));
    await test('inactive_slide_not_focusable', () => page.locator('#forecast-slide').evaluate(el => el.inert));
    await page.screenshot({ path: path.join(output, 'ホーム_スマホ.png'), fullPage: true });
    await page.getByRole('button', { name: 'メニューを開く' }).click();
    await page.locator('#sidebar').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
    await test('sidebar_open', () => page.locator('#sidebar').evaluate(el => el.open && el.getBoundingClientRect().left === 0));
    await test('menu_14_routes', () => page.locator('.menu-link').count().then(n => n === 14));
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
    await test('unbuilt_route_honest', () => page.locator('#pending-screen').isVisible());
    await page.getByRole('button', { name: 'ホームに戻る', exact: true }).click();
    await page.getByRole('button', { name: '口座残高 最後の確認は11月8日 1口座 ›' }).click();
    await test('confirmation_opens_real_detail', () => page.locator('#detail-dialog').innerText().then(t => t.includes('銀行明細') && t.includes('保存されません')));
    await page.getByRole('button', { name: '詳細を閉じる' }).click();
    await page.getByRole('button', { name: '残高の見通し', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#page-number').textContent === '2 / 2');
    await page.waitForFunction(() => Math.abs(document.querySelector('#carousel').scrollLeft - document.querySelector('#carousel').clientWidth) < 1);
    await test('carousel_second_page', () => page.locator('#balance-slide').evaluate(el => el.inert));
    await test('planned_incomes_in_table', () => page.locator('tbody').innerText().then(t => t.includes('給与') && t.includes('仕送り') && t.includes('¥73,000')));
    await page.getByRole('button', { name: '推移を再生' }).click();
    await page.waitForFunction(() => document.querySelector('#forecast-event').textContent.includes('カード引落') && document.querySelector('#forecast-amount').textContent === '¥80,000');
    await test('animation_updates_card_balance', () => page.locator('#forecast-amount').innerText().then(t => t === '¥80,000'));
    await page.getByRole('button', { name: '停止する' }).click();
    await test('animation_stops', () => page.locator('#play-forecast').getAttribute('aria-pressed').then(t => t === 'false'));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, '残高予測_スマホ.png'), fullPage: true });
    await test('capture_does_not_move_carousel', () => page.locator('#forecast-slide').evaluate(el => Math.abs(el.getBoundingClientRect().left - 20) < 2));
    await page.locator('#carousel').focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('#page-number').textContent === '1 / 2');
    await test('keyboard_carousel', () => page.locator('#page-number').innerText().then(t => t === '1 / 2'));
    await page.waitForFunction(() => document.querySelector('#carousel').scrollLeft < 1);
    // Touch input via Chromium reproduces horizontal swipe without touching the user's browser.
    await page.evaluate(() => window.scrollTo(0, 0));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 340, y: 350 }] });
    for (const x of [285, 230, 175, 120, 65]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 350 }] });
      await page.waitForTimeout(30); // Gesture sampling, not a page-readiness delay.
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('#page-number').textContent === '2 / 2', null, { timeout: 6000 });
    await test('touch_swipe_within_home', () => page.locator('#screen-name').innerText().then(t => t === 'ホーム'));
    await page.getByRole('button', { name: '現残高と支払い', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#page-number').textContent === '1 / 2');
    await page.locator('summary').click();
    for (const [value, expected] of Object.entries({ shortfall: '−¥70,000', empty: '口座がまだありません', loading: '読み込んでいます', offline: 'オフライン', error: '読み込めませんでした', success: '保存しました' })) {
      await page.locator('#preview-state').selectOption(value);
      await test('state_' + value, () => page.locator('#balance-content').innerText().then(t => t.includes(expected)));
    }
    await page.locator('#preview-state').selectOption('error');
    await page.locator('#balance-content [data-retry]').click();
    await test('retry_restores_data', () => page.locator('.amount').innerText().then(t => t === '¥50,000'));
    await page.locator('summary').click();
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await test('no_overflow_' + width, () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('button', { name: 'メニューを開く' }).click();
      await test('sidebar_fits_' + width, () => page.locator('#sidebar').evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth));
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(output, 'ホーム_PC.png'), fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '残高の見通し', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#page-number').textContent === '2 / 2');
    await page.getByRole('button', { name: '推移を再生' }).click();
    await test('reduced_motion_shows_final_balance', () => page.locator('#forecast-amount').innerText().then(t => t === '¥73,000'));
    await test('no_private_data_connections', () => external.length === 0);
    await test('console_errors', () => errors.length === 0);
  } catch (error) { checks.execution = 'fail'; errors.push(error.stack); const pages = browser?.contexts()[0]?.pages(); if (pages?.[0]) { await pages[0].screenshot({ path: path.join(output, '失敗箇所.png') }); errors.push(JSON.stringify(await pages[0].evaluate(() => ({ scroll: scrollY, left: document.querySelector('#carousel').scrollLeft, bounds: document.querySelector('#carousel').getBoundingClientRect().toJSON(), hit: document.elementFromPoint(340, 350)?.outerHTML.slice(0, 200) })))); } }
  finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
  const result = { total: Object.keys(checks).length, passed: Object.values(checks).filter(v => v === 'pass').length, checks, console_errors: errors, failed_details: Object.entries(checks).filter(([, v]) => v !== 'pass').map(([key]) => key) };
  fs.writeFileSync(path.join(output, 'UI検査.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (result.failed_details.length) process.exitCode = 1;
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
