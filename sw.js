// Works offline after the first open. The network wins when there is one, so updates show up at once.
const CACHE = 'daily-ayah-v2';
const FILES = ['./', 'app.js', 'core.js', 'render.js', 'zip.js', 'styles.css', 'data/quran.json', 'manifest.webmanifest', 'icon-180.png', 'NOTICE.txt'];
const FONT_HOST = 'https://fonts.gstatic.com/s/';
const FONTS = [
  'amiriquran/v19/_Xmo-Hk0rD6DbUL4_vH8Zp5v5i2ssg.woff2',
  'scheherazadenew/v21/4UaZrFhTvxVnHDvUkUiHg8jprP4DOwFmO24p.woff2',
  'ebgaramond/v33/SlGDmQSNjdsmc35JDF1K5E55YMjF_7DPuGi-6_RkBI9_.woff2',
  'inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiA.woff2',
].map((path) => FONT_HOST + path);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...FILES, ...FONTS]);
    await self.skipWaiting();
  })());
});

// Other sites on the same github.io address share this storage and can delete this cache,
// so put back anything missing whenever the app is opened online.
async function repair() {
  const cache = await caches.open(CACHE);
  await Promise.all([...FILES, ...FONTS].map(async (url) => {
    if (!(await cache.match(url, { ignoreVary: true }))) await cache.add(url).catch(() => {});
  }));
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('daily-ayah-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (request.url.startsWith(FONT_HOST)) {
    event.respondWith(caches.match(request, { ignoreVary: true }).then((hit) => hit || fetch(request)));
    return;
  }
  if (!request.url.startsWith(self.registration.scope)) return;

  if (request.mode === 'navigate') event.waitUntil(repair());
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok) event.waitUntil(cache.put(request, response.clone()));
      return response;
    } catch {
      return (await cache.match(request, { ignoreSearch: true, ignoreVary: true }))
        || (request.mode === 'navigate' ? cache.match('./') : Response.error());
    }
  })());
});
