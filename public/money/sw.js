// アプリのバージョンはこの1か所だけで管理する。
// index.html / app.js のクエリ(?v=)もこの値に合わせること。
//
// ★ index.html・app.js・finance-engine.js・styles.css などを1文字でも変えたら、必ず上げる。
//   下の fetch はキャッシュ優先なので、上げないと一度開いた端末には古いファイルが出続ける。
//   22 のまま finance-engine.js を2回直していて（09-09 名寄せ、09-13 部門コード）、スマホに届いていなかった。
//   tests/sw-version.test.js が、中身が変わったのに上げ忘れていないかを確かめる。
const VERSION = '28';
const CACHE = `okane-v${VERSION}`;
// index.html が読み込むURL（クエリ付き）と完全に一致させる。
// クエリが1文字でも違うと別URL扱いになり、プリキャッシュがヒットしない。
// './' は入れない。/money/ に同居させた構成では末尾スラッシュが
// /money への308リダイレクトになり、リダイレクトはキャッシュに入れられないため。
const ASSETS = [
  './index.html',
  `./styles.css?v=${VERSION}`,
  `./finance-engine.js?v=${VERSION}`,
  `./app.js?v=${VERSION}`,
  `./firebase-sync.js?v=${VERSION}`,
  `./icons/app-icon.svg?v=${VERSION}`
];
// addAll は1件でも失敗すると全体が失敗し、Service Worker が入らなくなる。
// 1件ずつ入れて、落ちたものは黙って飛ばす。
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});
// 同一オリジンに他のアプリ（/recipe のつくりおきノート）が同居しているため、
// 自分の接頭辞 'okane-' が付いたキャッシュだけを消す。
// 条件を key !== CACHE にすると、隣のアプリのキャッシュまで消してしまう。
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('okane-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // 同じサイトでも /money/ の外（切り替えバーの /shared/、共通の manifest やアイコン、ほかの2アプリ）は触らない。
  // キャッシュ優先で抱えると、それらを直しても VERSION を上げるまでこの端末に届かなくなる。
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('./index.html'))));
});
