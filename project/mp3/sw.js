/* UTSHOW Music — service worker
 * Versioned shell precache for the installable PWA.
 * Scope-relative URLs only, so it works at "/" locally and at
 * "/project/Mp3/" on GitHub Pages without changes.
 *
 * Strategy:
 *   - navigation / index.html  : network-first, falls back to cached shell
 *   - other shell files        : cache-first, immutable within each
 *                                cache version (updates roll through the
 *                                worker update lifecycle, never in place)
 *   - /api/* and cross-origin  : never intercepted (audio must hit the network)
 *   - any request with Range   : never intercepted
 *
 * Ownership: this worker only ever deletes caches that start with its own
 * prefix; other apps on the same origin keep their Cache Storage entries.
 */
'use strict';

const CACHE_VERSION = 'um-shell-0cbc626302';
const CACHE_PREFIX = 'um-shell-';
const CACHE_NAME = CACHE_VERSION;

/* Shell assets whose cache must succeed for install to complete.
 * If any of these fail, install is rejected and the previous worker stays
 * active, so the installed app never ends up without a working shell. */
const ESSENTIAL_ASSETS = [
  './index.html',
  './app.css',
  './config.js',
  './player.js',
  './core.js',
  './views.js',
  './app.js'
];

/* Shell assets cached best-effort. Install succeeds even if these fail;
 * the runtime shell handler will fetch / cache them on first miss. */
const OPTIONAL_ASSETS = [
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

const SHELL_ASSETS = ESSENTIAL_ASSETS.concat(OPTIONAL_ASSETS);

/* Entry point used when a navigation fails and nothing is cached for it. */
const OFFLINE_FALLBACK = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    /* Essential: a failure throws, rejecting install. The old worker
     * (and its cache) remains untouched and usable. */
    await Promise.all(ESSENTIAL_ASSETS.map(async (asset) => {
      const request = new Request(asset, { cache: 'reload' });
      const response = await fetch(request);
      if (!response || !response.ok) {
        throw new Error('precache failed for essential asset: ' + asset);
      }
      await cache.put(request, response);
    }));

    /* Optional: failures are ignored. Runtime shell handling will fill any
     * gaps on first use. */
    await Promise.all(OPTIONAL_ASSETS.map(async (asset) => {
      try {
        const request = new Request(asset, { cache: 'reload' });
        const response = await fetch(request);
        if (response && response.ok) {
          await cache.put(request, response);
        }
      } catch (e) {
        /* non-fatal */
      }
    }));

    /* No automatic skipWaiting: app.js decides when to activate an update. */
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    /* Only delete caches this worker owns. Cache Storage is shared across
     * all service-worker scopes on an origin, so a blanket delete would
     * clobber other apps. */
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key === CACHE_NAME) return false;
      if (key.indexOf(CACHE_PREFIX) !== 0) return false;
      return caches.delete(key).catch(() => false);
    }));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) { /* noop */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ---------------------------------------------------------------- helpers */

function isApiRequest(url) {
  /* Same-origin API lives under /api/ ; cross-origin is filtered earlier. */
  return /\/api\//.test(url.pathname);
}

function isShellRequest(url) {
  return SHELL_ASSETS.some((asset) => {
    try {
      return new URL(asset, self.location.href).pathname === url.pathname;
    } catch (e) {
      return false;
    }
  });
}

function isNavigationLike(request, url) {
  if (request.mode === 'navigate') return true;
  if (request.destination === 'document') return true;
  return /\/index\.html$/.test(url.pathname) || /\/$/.test(url.pathname);
}

/* True only for the app's real entry point: the scope root or ./index.html.
 * Other URLs in scope must never overwrite the offline fallback. */
function isAppEntryUrl(url) {
  try {
    const scopePath = new URL('./', self.location.href).pathname;
    const indexPath = new URL('./index.html', self.location.href).pathname;
    if (url.pathname === scopePath) return true;
    if (url.pathname === indexPath) return true;
  } catch (e) {
    return false;
  }
  return false;
}

function isHtmlResponse(response) {
  if (!response) return false;
  const ct = (response.headers.get('Content-Type') || '').toLowerCase();
  return ct.indexOf('text/html') !== -1;
}

async function cacheMatch(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(request, { ignoreSearch: false })) || undefined;
  } catch (e) {
    return undefined;
  }
}

async function cacheMatchShell() {
  try {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(OFFLINE_FALLBACK, { ignoreSearch: true })) || undefined;
  } catch (e) {
    return undefined;
  }
}

/* Write to the current versioned cache. Shell assets are immutable within
 * a cache version — an existing entry is never overwritten. Updates must
 * arrive as a new worker version, never as an in-place refresh. */
async function putInCache(request, response) {
  if (!response) return;
  if (response.type === 'opaque') return;
  if (response.status !== 200) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const existing = await cache.match(request);
    if (existing) return;
    await cache.put(request, response.clone());
  } catch (e) {
    /* Quota / opaque failures are non-fatal. */
  }
}

/* Update the offline shell document. Called only from navigations that
 * land on the app entry point, and only for HTML responses. */
async function updateFallback(response) {
  if (!response || response.status !== 200) return;
  if (!isHtmlResponse(response)) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(new Request(OFFLINE_FALLBACK, { cache: 'reload' }), response.clone());
  } catch (e) {
    /* Non-fatal — offline fallback will simply be stale but present. */
  }
}

/* --------------------------------------------------------------- handlers */

async function handleNavigation(event) {
  const request = event.request;
  const url = new URL(request.url);

  try {
    const preload = event.preloadResponse ? await event.preloadResponse : null;
    const response = preload || await fetch(request);

    if (response && response.ok) {
      /* Only the app entry point may refresh the offline fallback. */
      if (isAppEntryUrl(url)) {
        await updateFallback(response);
      }
      return response;
    }

    const cached = await cacheMatchShell();
    if (cached) return cached;
    return response;
  } catch (err) {
    const cached = await cacheMatchShell();
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>UTSHOW Music</title>' +
      '<body style="background:#050C1C;color:#BAC7DB;font:16px system-ui;' +
      'display:grid;place-items:center;height:100vh;margin:0">' +
      '<p>You are offline. Reconnect to keep listening.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function handleShell(event) {
  const request = event.request;
  const cached = await cacheMatch(request);
  if (cached) return cached;

  /* Cache miss: shell assets are precached at install time within the
   * current cache version, so a miss here is unusual. Serve and cache
   * from the network, awaited so the write survives worker shutdown. */
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await putInCache(request, response);
    }
    return response;
  } catch (err) {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  /* Only plain GETs are ever served from / into the cache. */
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  /* Never touch cross-origin traffic (streams, art, fonts via CDN, API base). */
  if (url.origin !== self.location.origin) return;

  /* Never touch the API — audio streams and JSON go straight to the network. */
  if (isApiRequest(url)) return;

  /* Never touch ranged requests (media seeks). */
  if (request.headers && request.headers.has('range')) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isNavigationLike(request, url)) {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (isShellRequest(url)) {
    event.respondWith(handleShell(event));
    return;
  }

  /* Everything else (same-origin, non-API, non-shell): cache-first miss
   * falls back to the network, with the write awaited inside the
   * respondWith promise so it survives worker shutdown. */
  event.respondWith((async () => {
    const cached = await cacheMatch(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        await putInCache(request, response);
      }
      return response;
    } catch (err) {
      return Response.error();
    }
  })());
});
