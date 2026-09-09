const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const http = require('http');
const ROOT = process.env.APP_ROOT || path.join(__dirname, '..', '..');
const STUB = fs.readFileSync(process.env.STUB_PATH || path.join(__dirname, 'stub-firebase-sync.js'), 'utf8');
const PORT = 8793;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
const server = http.createServer((req,res)=>{ const c=decodeURIComponent(req.url.split('?')[0]); const f=path.join(ROOT, c==='/'?'index.html':c);
  fs.readFile(f,(e,d)=>{ if(e){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); res.end(d); }); });

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname,'seed.json'),'utf8'));
const CANDIDATES = JSON.parse(fs.readFileSync(path.join(__dirname,'candidates.json'),'utf8'));

(async () => {
  await new Promise(r=>server.listen(PORT,r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.route('**/firebase-sync.js*', r => r.fulfill({ status:200, contentType:'text/javascript; charset=utf-8', body: STUB }));
  await page.addInitScript(s => { if(!localStorage.getItem('yoryoku-finance-v2')) localStorage.setItem('yoryoku-finance-v2', JSON.stringify(s)); localStorage.setItem('yoryoku-cloud-user','test-user'); }, SEED);
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil:'networkidle' });
  await page.waitForFunction(()=>Boolean(window.__YORYOKU__), null, { timeout:15000 });
  await page.evaluate(c => window.__YORYOKU__.setImportCandidates(c), CANDIDATES);

  const AUDIT = () => {
    const issues = [];
    const vw = document.documentElement.clientWidth;
    const hasScrollAncestor = el => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
        if (n.id === 'page-container') break;
      }
      return false;
    };
    const label = el => {
      const cls = (el.className && String(el.className).split(' ').slice(0, 3).join('.')) || '';
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
    };
    const textOf = el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30);

    // 1) カードごとの実効余白。中身がカードの端に張り付いていないか。
    document.querySelectorAll('#page-container .card, #page-container .settings-card').forEach(card => {
      const cr = card.getBoundingClientRect();
      if (cr.width === 0) return;
      let minLeft = Infinity, maxRight = -Infinity, worst = null;
      card.querySelectorAll('*').forEach(el => {
        if (el.closest('.card') !== card && el.closest('.settings-card') !== card) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (!textOf(el)) return;
        if (el.children.length > 0) return; // 実際に文字が載る末端要素だけを測る
        if (hasScrollAncestor(el)) return;
        const es = getComputedStyle(el);
        const ownL = parseFloat(es.paddingLeft) || 0;
        const ownR = parseFloat(es.paddingRight) || 0;
        const insetL = (r.left - cr.left) + ownL;
        const insetR = (cr.right - r.right) + ownR;
        if (insetL < minLeft) { minLeft = insetL; worst = el; }
        if (maxRight === -Infinity || insetR < maxRight) { maxRight = insetR; if (insetR < 8) worst = el; }
      });
      if (minLeft < 8 || maxRight < 8) {
        issues.push({ kind: 'padding', card: label(card), text: textOf(card), insetLeft: Math.round(minLeft), insetRight: Math.round(maxRight), worst: worst ? label(worst) : '' });
      }
    });

    // 2) ビューポートからのはみ出し（横スクロール可能な親を持つものは除く）
    document.querySelectorAll('#page-container *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (hasScrollAncestor(el)) return;
      if (r.right > vw + 1 || r.left < -1) {
        issues.push({ kind: 'viewport', sel: label(el), text: textOf(el), left: Math.round(r.left), right: Math.round(r.right) });
      }
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX === 'visible' && cs.overflow === 'visible') {
        issues.push({ kind: 'scroll', sel: label(el), text: textOf(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      }
    });

    const seen = new Map();
    issues.forEach(o => { const k = o.kind + '|' + (o.card || o.sel); if (!seen.has(k)) seen.set(k, o); });
    return { pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, issues: [...seen.values()] };
  };

  const pages = ['home','spendable','cashflow','plans','records','accounts','shift','settings','imports'];
  const report = {};
  for (const p of pages) {
    await page.evaluate(t => window.__YORYOKU__.setPage(t), p);
    await page.waitForTimeout(220);
    report[p] = await page.evaluate(AUDIT);
  }
  await browser.close(); server.close();
  console.log(JSON.stringify(report, null, 2));
})();
