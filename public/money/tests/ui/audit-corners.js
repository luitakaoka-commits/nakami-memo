const { chromium } = require('playwright');
const fs=require('fs'), path=require('path'), http=require('http');
const ROOT = process.env.APP_ROOT || path.join(__dirname, '..', '..');
const STUB = fs.readFileSync(process.env.STUB_PATH || path.join(__dirname, 'stub-firebase-sync.js'), 'utf8');
const PORT=8799;
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((q,s)=>{const c=decodeURIComponent(q.url.split('?')[0]);const f=path.join(ROOT,c==='/'?'index.html':c);fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});s.end(d);});});
const SEED=JSON.parse(fs.readFileSync(path.join(__dirname,'seed.json'),'utf8'));
const CANDIDATES=JSON.parse(fs.readFileSync(path.join(__dirname,'candidates.json'),'utf8'));
(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const width=Number(process.env.W||412);
  const ctx=await b.newContext({viewport:{width,height:900}});
  const p=await ctx.newPage();
  await p.route('**/firebase-sync.js*',r=>r.fulfill({status:200,contentType:'text/javascript; charset=utf-8',body:STUB}));
  await p.addInitScript(s=>{if(!localStorage.getItem('yoryoku-finance-v2'))localStorage.setItem('yoryoku-finance-v2',JSON.stringify(s));localStorage.setItem('yoryoku-cloud-user','test-user');},SEED);
  await p.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'networkidle'});
  await p.waitForFunction(()=>Boolean(window.__YORYOKU__),null,{timeout:15000});
  await p.evaluate(c=>window.__YORYOKU__.setImportCandidates(c),CANDIDATES);
  await p.evaluate(m=>{window.__CORNER_MARGIN__=m;}, Number(process.env.MARGIN||0.5));

  const CORNERS = () => {
    const bad=[];
    const label=el=>{const c=(el.className&&String(el.className).split(' ').slice(0,2).join('.'))||'';return `${el.tagName.toLowerCase()}${c?'.'+c:''}`;};
    const txt=el=>(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,26);
    // 文字が実際に占める矩形を取得する（Range を使うと行単位で正確に測れる）
    const textRects = el => {
      const rs=[];
      el.childNodes.forEach(n=>{
        if(n.nodeType!==3 || !n.textContent.trim()) return;
        const rg=document.createRange(); rg.selectNodeContents(n);
        for(const r of rg.getClientRects()) if(r.width>0&&r.height>0) rs.push(r);
      });
      return rs;
    };
    document.querySelectorAll('#page-container *').forEach(box=>{
      const cs=getComputedStyle(box);
      const r=Math.min(parseFloat(cs.borderTopLeftRadius)||0, 60);
      if(r<8) return;
      const b=box.getBoundingClientRect();
      if(b.width===0||b.height===0) return;
      if(cs.overflow==='hidden'||cs.overflowX==='hidden') return; // クリップ済み
      const corners=[
        {cx:b.left+r, cy:b.top+r, sx:-1, sy:-1, name:'左上', rr:parseFloat(cs.borderTopLeftRadius)||0},
        {cx:b.right-r, cy:b.top+r, sx:1, sy:-1, name:'右上', rr:parseFloat(cs.borderTopRightRadius)||0},
        {cx:b.left+r, cy:b.bottom-r, sx:-1, sy:1, name:'左下', rr:parseFloat(cs.borderBottomLeftRadius)||0},
        {cx:b.right-r, cy:b.bottom-r, sx:1, sy:1, name:'右下', rr:parseFloat(cs.borderBottomRightRadius)||0}
      ];
      box.querySelectorAll('*').forEach(el=>{
        if(el.children.length>0) return;
        textRects(el).forEach(tr=>{
          corners.forEach(c=>{
            if(c.rr<8) return;
            // 文字矩形の、その角に最も近い頂点
            const px = c.sx<0 ? tr.left : tr.right;
            const py = c.sy<0 ? tr.top  : tr.bottom;
            const inCornerBox = (c.sx<0 ? px < c.cx : px > c.cx) && (c.sy<0 ? py < c.cy : py > c.cy);
            if(!inCornerBox) return;
            const d=Math.hypot(px-c.cx, py-c.cy);
            const MARGIN = Number(window.__CORNER_MARGIN__ || 0.5);
            if(d > r - MARGIN) bad.push({ box: label(box), boxText: txt(box), corner: c.name, radius:+r.toFixed(1), clearance:+(r-d).toFixed(1), el: label(el), text: txt(el) });
          });
        });
      });
    });
    const seen=new Map();
    bad.forEach(o=>{const k=o.box+'|'+o.corner+'|'+o.el; if(!seen.has(k)||seen.get(k).overhang<o.overhang) seen.set(k,o);});
    return [...seen.values()].sort((a,b)=>b.overhang-a.overhang);
  };

  const pages=['home','spendable','cashflow','plans','records','accounts','shift','settings','imports'];
  const rep={};
  for(const n of pages){ await p.evaluate(t=>window.__YORYOKU__.setPage(t),n); await p.waitForTimeout(220); const x=await p.evaluate(CORNERS); if(x.length) rep[n]=x; }
  // モーダルも確認
  await p.evaluate(()=>{document.querySelector('[data-action="add-event"]')?.click();});
  await p.waitForTimeout(500);
  const m=await p.evaluate(()=>{ const f=window.__CORNER__; return null; });
  await b.close(); server.close();
  console.log(JSON.stringify(Object.keys(rep).length?rep:{result:`${width}px: 角丸に食い込む文字なし`},null,2));
})();
