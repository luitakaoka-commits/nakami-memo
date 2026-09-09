/* つくりおきノートの Service Worker。
   アプリの外枠（HTML/CSS/JS）と Firebase SDK をキャッシュして、
   オフラインでも起動できるようにする。
   データ本体は Firestore のオフライン永続化（IndexedDB）が持つので、ここでは扱わない。 */

const VERSION = "v6";
const SHELL_CACHE = "tsukurioki-shell-" + VERSION;
const SDK_CACHE = "tsukurioki-sdk-" + VERSION;

/* "./" は入れない。/recipe/ に同居させた構成では末尾スラッシュが
   /recipe への308リダイレクトになり、リダイレクトはキャッシュに入れられないため。 */
const SHELL = [
  "./index.html",
  "./tokens.css",
  "./style.css",
  "./app.js",
  "./firebase.js",
  "./firebase-config.js",
  "./store.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

const SDK = [
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map((url) => shell.add(url).catch(() => {})));
    const sdk = await caches.open(SDK_CACHE);
    await Promise.all(SDK.map((url) => sdk.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("tsukurioki-") && key !== SHELL_CACHE && key !== SDK_CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

/* Firestore・Storage・認証の通信には触らない（独自の再送とオフライン処理を持っているため）。 */
function isFirebaseTraffic(url) {
  return /(^|\.)googleapis\.com$/.test(url.hostname)
    || /(^|\.)firebaseio\.com$/.test(url.hostname)
    || /(^|\.)firebaseapp\.com$/.test(url.hostname)
    || url.hostname === "accounts.google.com"
    || url.hostname === "apis.google.com"
    || url.hostname === "securetoken.googleapis.com"
    || url.hostname === "identitytoolkit.googleapis.com";
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isFirebaseTraffic(url)) return;

  /* 画面遷移：まずネットワーク、だめならキャッシュした index.html */
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        /* リダイレクト（type が "opaqueredirect"）や失敗レスポンスはキャッシュに入れられない。
           入れようとすると respondWith ごと失敗して画面が真っ白になるので、条件を絞る。 */
        if (fresh && fresh.ok && fresh.type === "basic") {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put("./index.html", fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (error) {
        const cached = await caches.match("./index.html");
        return cached || Response.error();
      }
    })());
    return;
  }

  /* Firebase SDK：キャッシュ優先（バージョン固定なので中身は変わらない） */
  if (url.hostname === "www.gstatic.com") {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const fresh = await fetch(request);
      const cache = await caches.open(SDK_CACHE);
      cache.put(request, fresh.clone());
      return fresh;
    })());
    return;
  }

  /* 自分のファイル：キャッシュを返しつつ裏で更新する */
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request).then((response) => {
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      }).catch(() => cached);
      return cached || network;
    })());
  }
});
