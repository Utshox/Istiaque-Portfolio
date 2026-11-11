/* UTSHOW Music (web) — core.js (v1.2)
 * UM.core + UM.ui: multi-user auth, API client, library synchronization,
 * UI helpers, modal dialogs, context menus, and shared component builders.
 * Strictly conforms to UTSHOW Music web spec (v1.2) and static/app.css.
 *
 * Fix round 4:
 *  - Library state is scoped to an auth generation; logout resets it and
 *    cancels pending saves so one account can never PUT another's data.
 *  - Library saves are serialized and revision-checked; stale responses never
 *    clobber newer local edits.
 *  - 401 handling only clears a session that is still the current one.
 *  - trackRow plays on double-click (desktop) or single tap (touch) exactly once.
 *  - Playback provenance ({auto, source}) is forwarded to player.playList and
 *    to /api/feedback.
 *  - prompt()/confirm() always resolve (Escape and scrim click included).
 *  - Context menus close on Escape; UM.ui.closeMenu exported.
 *  - Touch hit areas patched to >= 44px on phones.
 *  - Card play buttons actually play albums / artists / playlists / mixes.
 *  - card() supports all contracted kinds (album/playlist/artist/mix/station/mood).
 */
(function () {
  'use strict';

  var UM = window.UM || (window.UM = {});

  /* ------------------------------------------------------------------ *
   * Platform & Device Detection
   * ------------------------------------------------------------------ */
  /* Chrome/Edge fire beforeinstallprompt once the PWA is installable; keep it
     for the Settings "Install app" button (Chrome's own menu still works too). */
  window.addEventListener('beforeinstallprompt', function (e) { window.__umInstallPrompt = e; });
  window.addEventListener('appinstalled', function () { window.__umInstallPrompt = null; });

  function isIOS() {
    if (typeof navigator === 'undefined') return false;
    var ua = navigator.userAgent || '';
    var platform = navigator.platform || '';
    var maxTouch = navigator.maxTouchPoints || 0;
    return /iP(hone|ad|od)/.test(ua) || (platform === 'MacIntel' && maxTouch > 1);
  }

  function isTouch() {
    if (typeof window === 'undefined') return false;
    return ('ontouchstart' in window) ||
      (navigator && (navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0));
  }

  function isPhone() {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 700;
  }

  /* ------------------------------------------------------------------ *
   * Inline SVG Icons (safe constant strings)
   * ------------------------------------------------------------------ */
  var ICONS = {
    note: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
    lib: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    heartFill: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16"/><rect x="15" y="4" width="4" height="16"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="19,20 9,12 19,4"/><rect x="5" y="4" width="2" height="16"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,4 15,12 5,20"/><rect x="17" y="4" width="2" height="16"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
    repeatOne: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.8v4H13z"/></svg>',
    volHigh: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
    volMute: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>',
    queue: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>',
    lyrics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    radio: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.24 6.15C2.51 7.43 2 8.94 2 10.58c0 3.79 2.6 6.99 6.18 7.93l.63-1.9C5.83 15.86 4 13.43 4 10.58c0-1.19.37-2.31 1.01-3.25l-1.77-1.18zm17.52 0l-1.77 1.18C19.63 8.27 20 9.39 20 10.58c0 2.85-1.83 5.28-4.81 6.03l.63 1.9C19.4 17.57 22 14.37 22 10.58c0-1.64-.51-3.15-1.24-4.43zM7.05 8.68C6.39 9.24 6 10.05 6 10.95c0 1.66 1.34 3 3 3 .89 0 1.7-.39 2.26-1.04L7.05 8.68zm9.9 0l-4.21 4.23c.56.65 1.37 1.04 2.26 1.04 1.66 0 3-1.34 3-3 0-.9-.39-1.71-1.05-2.27zM12 2C7.03 2 3 6.03 3 11c0 2.12.74 4.07 1.97 5.61l1.46-1.38C5.46 13.98 5 12.55 5 11c0-3.87 3.13-7 7-7s7 3.13 7 7c0 1.55-.46 2.98-1.43 4.23l1.46 1.38C20.26 15.07 21 13.12 21 11c0-4.97-4.03-9-9-9zm0 7c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    sort: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/></svg>',
    collapse: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>'
  };

  function icon(name) {
    return ICONS[name] || ICONS.note;
  }

  /* ------------------------------------------------------------------ *
   * Touch-target patch (>= 44px hit areas on phones).
   * Only sizing / hit-area rules — no layout or colour changes.
   * ------------------------------------------------------------------ */
  (function injectTouchPatch() {
    var CSS = [
      '@media (max-width:700px){',
      '.um-track .um-like,.um-track .um-icon-btn{width:44px;height:44px}',
      '.um-track .um-icon-btn svg{width:20px;height:20px}',
      '.um-track .um-like svg{width:20px;height:20px}',
      '.um-track-actions{gap:0;opacity:1}',
      '.um-tracks .um-track{grid-template-columns:24px 40px minmax(0,1fr) 44px 88px}',
      '.um-tracks--noart .um-track{grid-template-columns:24px minmax(0,1fr) 44px 88px}',
      '.um-card-play{width:44px;height:44px}',
      '.um-shortcut-play{width:44px;height:44px}',
      '.um-section-all{min-height:44px;display:inline-flex;align-items:center}',
      '.um-np-row .um-like{width:44px;height:44px}',
      '}',
      '@media (hover:none){',
      '.um-menu-item{min-height:44px}',
      '.um-like{min-width:44px;min-height:44px}',
      '}'
    ].join('');

    function add() {
      if (typeof document === 'undefined') return;
      if (document.getElementById('um-core-touch')) return;
      var s = document.createElement('style');
      s.id = 'um-core-touch';
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    }

    if (typeof document === 'undefined') return;
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add, { once: true });
  })();

  /* ------------------------------------------------------------------ *
   * Core Event Bus
   * ------------------------------------------------------------------ */
  var eventListeners = Object.create(null);

  function on(ev, fn) {
    if (!ev || typeof fn !== 'function') return;
    if (!eventListeners[ev]) eventListeners[ev] = new Set();
    eventListeners[ev].add(fn);
  }

  function off(ev, fn) {
    var s = eventListeners[ev];
    if (s) s.delete(fn);
  }

  function emit(ev, data) {
    var s = eventListeners[ev];
    if (!s || !s.size) return;
    var list = Array.from(s);
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](data);
      } catch (e) {
        console.error('[UM.core] Listener error for "' + ev + '":', e);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * DOM Builder helper: h(tag, attrs, ...children)
   * ------------------------------------------------------------------ */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    var children = [];
    for (var argIdx = 2; argIdx < arguments.length; argIdx++) {
      children.push(arguments[argIdx]);
    }

    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null) continue;
        if (k === 'className') {
          el.className = v;
        } else if (k === 'text') {
          el.textContent = v;
        } else if (k === 'html') {
          el.innerHTML = v;
        } else if (k === 'children') {
          if (Array.isArray(v)) {
            for (var ci = 0; ci < v.length; ci++) children.push(v[ci]);
          } else {
            children.push(v);
          }
        } else if (k.indexOf('on') === 0 && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else {
          el.setAttribute(k, v);
        }
      }
    }

    function appendChildNode(c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) {
        for (var i = 0; i < c.length; i++) appendChildNode(c[i]);
      } else if (typeof c === 'string' || typeof c === 'number') {
        el.appendChild(document.createTextNode(String(c)));
      } else if (c.nodeType) {
        el.appendChild(c);
      }
    }

    for (var j = 0; j < children.length; j++) {
      appendChildNode(children[j]);
    }
    return el;
  }

  function clearEl(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  function fmtTime(sec) {
    var s = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(s / 60);
    var rem = s % 60;
    return m + ':' + (rem < 10 ? '0' : '') + rem;
  }

  function resizeArtUrl(url, size) {
    if (!url) return '';
    if (url.indexOf('=') >= 0 && /=w\d+-h\d+/i.test(url)) {
      return url.replace(/=w\d+-h\d+[^"]*/i, '=w' + size + '-h' + size + '-l90-rj');
    }
    return url;
  }

  function img(url, cls) {
    var wrapper = h('div', { className: 'um-img-fallback', html: ICONS.note });
    if (!url) {
      if (cls) wrapper.className += ' ' + cls;
      return wrapper;
    }
    var imageEl = h('img', {
      src: url,
      loading: 'lazy',
      className: cls || '',
      alt: ''
    });
    imageEl.onerror = function () {
      if (imageEl.parentNode) {
        var fb = h('div', { className: 'um-img-fallback' + (cls ? ' ' + cls : ''), html: ICONS.note });
        imageEl.parentNode.replaceChild(fb, imageEl);
      }
    };
    return imageEl;
  }

  /* ------------------------------------------------------------------ *
   * Dominant Color Extraction (returns Promise<rgb string>)
   * ------------------------------------------------------------------ */
  function dominantColor(url) {
    return new Promise(function (resolve) {
      if (!url) {
        resolve('rgba(31, 111, 224, 0.28)');
        return;
      }
      var image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, 0, 1, 1);
          var d = ctx.getImageData(0, 0, 1, 1).data;
          resolve('rgba(' + d[0] + ', ' + d[1] + ', ' + d[2] + ', 0.32)');
        } catch (e) {
          resolve('rgba(31, 111, 224, 0.28)');
        }
      };
      image.onerror = function () {
        resolve('rgba(31, 111, 224, 0.28)');
      };
      image.src = url;
    });
  }

  /* ------------------------------------------------------------------ *
   * URL & API Endpoints
   * ------------------------------------------------------------------ */
  function getApiBase() {
    try {
      var stored = localStorage.getItem('um.apiBase');
      // 2026-11-12: the server moved from GCP to Oracle; drop the old saved address.
      if (stored && /35-208-88-166\.sslip\.io/.test(stored)) { localStorage.removeItem('um.apiBase'); stored = null; }
      if (stored != null && stored !== '') return stored.replace(/\/+$/, '');
    } catch (e) {}
    if (window.UM_CONFIG && window.UM_CONFIG.apiBase) {
      return String(window.UM_CONFIG.apiBase).replace(/\/+$/, '');
    }
    return '';
  }

  function setApiBase(base) {
    try {
      if (!base) localStorage.removeItem('um.apiBase');
      else localStorage.setItem('um.apiBase', String(base).trim().replace(/\/+$/, ''));
    } catch (e) {}
  }

  function api(path) {
    var base = getApiBase();
    if (/^https?:\/\//i.test(path)) return path;
    if (!path) return base || '';
    if (path.charAt(0) !== '/') path = '/' + path;
    return (base ? base + path : path);
  }

  /* Some ad blockers (AdGuard on Android) strip <link rel="manifest"> from
     the HTML, which makes Chrome say "This app cannot be installed". Put it
     back from JS if it is missing. */
  (function ensureManifest() {
    try {
      if (!document.querySelector('link[rel="manifest"]')) {
        var l = document.createElement('link');
        l.rel = 'manifest';
        l.href = 'manifest.json';
        document.head.appendChild(l);
      }
    } catch (e) {}
  })();

  function getToken() {
    try {
      return localStorage.getItem('um.token') || '';
    } catch (e) {
      return '';
    }
  }

  function setToken(tok) {
    try {
      if (tok) localStorage.setItem('um.token', tok);
      else { localStorage.removeItem('um.token'); cacheClear(); }
    } catch (e) {}
  }

  /* Per-user response cache (stale-while-revalidate). Keyed by the uid part
     of the token, so two accounts on one device never see each other's data;
     cleared on sign-out. */
  function cacheUid() { var t = getToken(); return t ? t.split('.')[0] : ''; }
  function cacheGet(path) {
    try {
      var u = cacheUid(); if (!u) return null;
      var raw = localStorage.getItem('um.c.' + u + '.' + path);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function cachePut(path, data) {
    try {
      var u = cacheUid(); if (!u || !data) return;
      localStorage.setItem('um.c.' + u + '.' + path, JSON.stringify(data));
    } catch (e) {}
  }
  function cacheClear() {
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('um.c.') === 0) localStorage.removeItem(k);
      });
    } catch (e) {}
  }

  function getCachedUser() {
    try {
      var raw = localStorage.getItem('um.user');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setCachedUser(u) {
    try {
      if (u) localStorage.setItem('um.user', JSON.stringify(u));
      else localStorage.removeItem('um.user');
    } catch (e) {}
  }

  /* Effective quality for this device: iOS Safari can't play Opus/webm
     reliably, so "high" falls back to 128 kbps AAC and "low" uses the AAC
     data-saver track. */
  function streamQuality() {
    var L = (UM.core && UM.core.lib) || null;
    var q = (L && L.settings && L.settings.quality) || 'normal';
    if (isIOS()) {
      if (q === 'high') return 'normal';
      if (q === 'low') return 'low-aac';
    }
    return q;
  }

  /* Ask the server to look songs up ahead of time (each cold lookup costs it
     ~5 s). Each id is sent at most once per 20 minutes. */
  var prefetchSent = {};
  function prefetch(ids) {
    var now = Date.now(), out = [];
    for (var i = 0; i < (ids || []).length && out.length < 3; i++) {
      var id = ids[i];
      if (!id || (prefetchSent[id] && now - prefetchSent[id] < 1200000)) continue;
      prefetchSent[id] = now;
      out.push(id);
    }
    if (!out.length || !getToken()) return;
    req('/api/prefetch', { method: 'POST', body: { ids: out, q: streamQuality() } }).catch(function () {});
  }

  function streamUrl(id) {
    var url = api('/api/stream/' + encodeURIComponent(id));
    var q = streamQuality();
    if (q !== 'normal') url += '?q=' + encodeURIComponent(q);
    var tok = getToken();
    if (tok) {
      url += (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + encodeURIComponent(tok);
    }
    return url;
  }

  /* Export primary URL resolvers to window.UM */
  UM.api = api;
  UM.streamUrl = streamUrl;

  /* ------------------------------------------------------------------ *
   * Auth Generation — every account switch bumps this. Anything captured
   * with an older generation is stale and must be discarded.
   * ------------------------------------------------------------------ */
  var authGen = 0;

  /* ------------------------------------------------------------------ *
   * HTTP Client (UM.req)
   * ------------------------------------------------------------------ */
  function req(path, opts) {
    opts = opts || {};
    var fullUrl = api(path);
    var headers = Object.assign({}, opts.headers || {});
    var tokenUsed = getToken();
    var genUsed = authGen;
    if (tokenUsed && !headers['Authorization']) {
      headers['Authorization'] = 'Bearer ' + tokenUsed;
    }
    /* Local timezone for the time-of-day mix and weather (no GPS prompt). */
    if (!headers['X-UM-TZ']) {
      try { headers['X-UM-TZ'] = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    }

    var body = opts.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    return fetch(fullUrl, {
      method: opts.method || 'GET',
      headers: headers,
      body: body,
      keepalive: !!opts.keepalive
    }).then(function (r) {
      if (r.status === 401) {
        /* Only tear the session down if this request belonged to the session
         * that is still current; a late 401 from a previous account must not
         * log out a freshly authenticated user. */
        var stillCurrent = (genUsed === authGen) && (getToken() === tokenUsed);
        if (!opts.noAuthRedirect && stillCurrent) {
          authGen++;
          setToken('');
          setCachedUser(null);
          resetLibrary();
          emit('auth', { authenticated: false, user: null });
          if (typeof UM.core.onAuthRequired === 'function') UM.core.onAuthRequired();
        }
        return r.json().catch(function () { return { error: 'Unauthorized' }; }).then(function (err) {
          throw new Error(err.error || 'Authentication required');
        });
      }
      if (!r.ok) {
        return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }).then(function (err) {
          throw new Error(err.error || ('Request failed (' + r.status + ')'));
        });
      }
      if (opts.raw) return r;
      return r.json();
    });
  }

  UM.req = req;
  UM.cacheGet = cacheGet;
  UM.cachePut = cachePut;
  /* GET with cache: returns the network promise (which also refreshes the
     cache); the cached copy, if any, is available synchronously via cacheGet. */
  UM.reqCached = function (path) {
    return req(path).then(function (d) {
      if (d && !d.error) cachePut(path, d);
      return d;
    });
  };

  /* ------------------------------------------------------------------ *
   * Multi-user Authentication API
   * ------------------------------------------------------------------ */
  function login(name, passphrase) {
    return req('/api/login', {
      method: 'POST',
      body: { name: name, passphrase: passphrase },
      noAuthRedirect: true
    }).then(function (res) {
      if (res && res.token) {
        authGen++;
        resetLibrary();
        setToken(res.token);
        setCachedUser(res.user || { name: name });
        emit('auth', { authenticated: true, user: res.user });
      }
      return res;
    });
  }

  function register(invite, name, passphrase) {
    return req('/api/register', {
      method: 'POST',
      body: { invite: invite, name: name, passphrase: passphrase },
      noAuthRedirect: true
    }).then(function (res) {
      if (res && res.token) {
        authGen++;
        resetLibrary();
        setToken(res.token);
        setCachedUser(res.user || { name: name });
        emit('auth', { authenticated: true, user: res.user });
      }
      return res;
    });
  }

  function logout() {
    authGen++;
    setToken('');
    setCachedUser(null);
    resetLibrary();
    emit('auth', { authenticated: false, user: null });
    if (typeof UM.core.onAuthRequired === 'function') UM.core.onAuthRequired();
  }

  function me() {
    return getCachedUser();
  }

  /* ------------------------------------------------------------------ *
   * Library State Management
   *  - libState is mutated in place (stable reference for UM.core.lib)
   *  - libRev increments on every local edit; a save response is only
   *    adopted when no newer edit happened while it was in flight.
   *  - Saves are serialized: at most one PUT in flight, a follow-up runs
   *    if edits arrived meanwhile.
   *  - Everything is bound to authGen: a save queued for one account is
   *    never sent under another account's token.
   * ------------------------------------------------------------------ */
  var DEFAULT_SETTINGS = { volume: 0.8, shuffle: false, repeat: 'off', crossfade: 0 };

  var libState = {
    liked: [],
    history: [],
    playlists: [],
    settings: Object.assign({}, DEFAULT_SETTINGS)
  };

  var libRev = 0;
  var saveTimer = null;
  var saving = false;
  var savingPromise = null;
  var pendingSave = false;

  function markDirty() {
    libRev++;
  }

  function adoptLibrary(data) {
    libState.liked = Array.isArray(data.liked) ? data.liked : [];
    libState.history = Array.isArray(data.history) ? data.history : [];
    libState.playlists = Array.isArray(data.playlists) ? data.playlists : [];
    libState.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
  }

  function resetLibrary() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    pendingSave = false;
    saving = false;
    savingPromise = null;
    libRev = 0;
    libState.liked = [];
    libState.history = [];
    libState.playlists = [];
    libState.settings = Object.assign({}, DEFAULT_SETTINGS);
    emit('library', libState);
  }

  function loadLibrary() {
    var gen = authGen;
    return req('/api/library').then(function (data) {
      if (gen !== authGen) return libState; /* account changed mid-flight */
      if (data && typeof data === 'object' && !data.error) {
        cachePut('/api/library', data);
        if (libRev > 0) return libState; /* local edits pending; their save wins */
        adoptLibrary(data);
        libRev = 0;
        emit('library', libState);
      }
      return libState;
    });
  }

  /* Instant start: adopt the last library this device saw for this user. */
  function loadCachedLibrary() {
    var data = cacheGet('/api/library');
    if (!data || typeof data !== 'object') return false;
    adoptLibrary(data);
    libRev = 0;
    emit('library', libState);
    return true;
  }

  function snapshotPayload() {
    return {
      liked: libState.liked || [],
      playlists: libState.playlists || [],
      settings: libState.settings || {},
      history: libState.history || []
    };
  }

  function saveLibrary() {
    if (saving) {
      pendingSave = true;
      return savingPromise || Promise.resolve(null);
    }

    var gen = authGen;
    var rev = libRev;
    var payload = snapshotPayload();
    saving = true;
    pendingSave = false;

    var p = req('/api/library', {
      method: 'PUT',
      body: payload
    }).then(function (data) {
      if (gen !== authGen) return null;
      if (data && typeof data === 'object' && !data.error) {
        if (rev === libRev) {
          /* No newer edits: it is safe to adopt the server's canonical copy. */
          adoptLibrary(data);
          emit('library', libState);
        } else {
          /* Newer local edits exist — keep them and save again after this. */
          pendingSave = true;
        }
      }
      return data;
    }, function (err) {
      if (gen === authGen) {
        toast('Failed to save library: ' + ((err && err.message) || 'network error'), 'error');
      }
      return null;
    }).then(function (data) {
      saving = false;
      savingPromise = null;
      if (gen === authGen && pendingSave) {
        pendingSave = false;
        return saveLibrary();
      }
      return data;
    });

    savingPromise = p;
    return p;
  }

  function scheduleSaveLibrary() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveLibrary().catch(function () {});
    }, 800);
  }

  function isLiked(id) {
    if (!id) return false;
    var list = libState.liked || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return true;
    }
    return false;
  }

  function toggleLike(track, source) {
    if (!track || !track.id) return;
    var list = libState.liked || (libState.liked = []);
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === track.id) { idx = i; break; }
    }
    var kind = 'like';
    if (idx >= 0) {
      list.splice(idx, 1);
      kind = 'unlike';
      toast('Removed from Liked Songs');
    } else {
      list.unshift(track);
      kind = 'like';
      toast('Added to Liked Songs');
    }
    markDirty();
    scheduleSaveLibrary();
    emit('library', libState);
    feedback(kind, track, { listenedSec: 0, duration: track.duration || 0, source: source || 'library' });
  }

  function addToPlaylist(pid, track) {
    if (!pid || !track || !track.id) return false;
    var pls = libState.playlists || [];
    for (var i = 0; i < pls.length; i++) {
      if (pls[i].id === pid) {
        if (!pls[i].tracks) pls[i].tracks = [];
        pls[i].tracks.push(track);
        markDirty();
        scheduleSaveLibrary();
        emit('library', libState);
        toast('Added to "' + pls[i].name + '"');
        return true;
      }
    }
    return false;
  }

  function createPlaylist(name) {
    var n = (name || '').trim();
    if (!n) return null;
    var pl = { id: 'pl-' + Date.now() + '-' + Math.floor(Math.random() * 1000), name: n, tracks: [] };
    if (!libState.playlists) libState.playlists = [];
    libState.playlists.push(pl);
    markDirty();
    scheduleSaveLibrary();
    emit('library', libState);
    toast('Created playlist "' + n + '"');
    return pl;
  }

  function createPlaylistWithTracks(name, tracks) {
    var n = (name || '').trim() || 'Imported playlist';
    var seen = {};
    var list = (tracks || []).filter(function (t) {
      if (!t || !t.id || seen[t.id]) return false;
      seen[t.id] = true;
      return true;
    });
    var pl = { id: 'pl-' + Date.now() + '-' + Math.floor(Math.random() * 1000), name: n, tracks: list };
    if (!libState.playlists) libState.playlists = [];
    libState.playlists.push(pl);
    markDirty();
    scheduleSaveLibrary();
    emit('library', libState);
    return pl;
  }

  function renamePlaylist(pid, newName) {
    var n = (newName || '').trim();
    if (!n || !pid) return false;
    var pls = libState.playlists || [];
    for (var i = 0; i < pls.length; i++) {
      if (pls[i].id === pid) {
        pls[i].name = n;
        markDirty();
        scheduleSaveLibrary();
        emit('library', libState);
        toast('Renamed playlist');
        return true;
      }
    }
    return false;
  }

  function deletePlaylist(pid) {
    if (!pid) return false;
    var pls = libState.playlists || [];
    var idx = -1;
    for (var i = 0; i < pls.length; i++) {
      if (pls[i].id === pid) { idx = i; break; }
    }
    if (idx >= 0) {
      pls.splice(idx, 1);
      markDirty();
      scheduleSaveLibrary();
      emit('library', libState);
      toast('Deleted playlist');
      return true;
    }
    return false;
  }

  function recordHistory(track) {
    if (!track || !track.id) return;
    var list = libState.history || (libState.history = []);
    var filtered = list.filter(function (t) { return t.id !== track.id; });
    var entry = Object.assign({}, track, { playedAt: new Date().toISOString() });
    filtered.unshift(entry);
    if (filtered.length > 300) filtered.length = 300;
    libState.history = filtered;
    markDirty();
    scheduleSaveLibrary();
    emit('library', libState);
  }

  function feedback(kind, track, extra) {
    if (!track || !track.id || !kind) return;
    extra = extra || {};
    var body = {
      id: track.id,
      track: track,
      kind: kind,
      auto: !!extra.auto,
      listenedSec: Math.max(0, Math.round(extra.listenedSec || 0)),
      duration: Math.max(0, Math.round(extra.duration || track.duration || 0))
    };
    if (extra.source) body.source = String(extra.source);
    req('/api/feedback', {
      method: 'POST',
      body: body,
      keepalive: true
    }).catch(function () {});
  }

  /* ------------------------------------------------------------------ *
   * Playback helper — forwards provenance so the engine (and the ranking
   * log) can tell whether a track was recommended or explicitly chosen.
   * player.playList(tracks, startIndex, {auto, source}) — the third
   * argument is optional and ignored by older engine builds.
   * ------------------------------------------------------------------ */
  function playTracks(tracks, startIndex, opts) {
    if (!UM.player || typeof UM.player.playList !== 'function') return;
    var list = (tracks || []).filter(function (t) { return t && t.id; });
    if (!list.length) return;
    var idx = Math.max(0, Math.min(list.length - 1, Math.round(startIndex || 0)));
    var options = opts ? { auto: !!opts.auto, source: opts.source || null } : undefined;
    try {
      UM.player.playList(list, idx, options);
    } catch (e) {
      UM.player.playList(list, idx);
    }
  }

  /* ------------------------------------------------------------------ *
   * UI Helpers: Toasts, Menus, Dialogs
   * ------------------------------------------------------------------ */
  var toastContainer = null;
  function toast(msg, kind) {
    if (!toastContainer) {
      toastContainer = h('div', { className: 'um-toasts' });
      document.body.appendChild(toastContainer);
    }
    var cls = 'um-toast';
    if (kind === 'error') cls += ' um-toast--error';
    else if (kind === 'update') cls += ' um-toast--update';

    var toastEl = h('div', { className: cls, text: msg });
    toastContainer.appendChild(toastEl);
    setTimeout(function () {
      if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    }, 3200);
    return toastEl;
  }

  var activeMenuEl = null;

  function onMenuKeyDown(e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      closeMenu();
    }
  }

  function closeMenu(fromPop, noBack) {
    var wasOpen = !!activeMenuEl;
    if (activeMenuEl) {
      if (activeMenuEl.parentNode) activeMenuEl.parentNode.removeChild(activeMenuEl);
      activeMenuEl = null;
    }
    document.removeEventListener('keydown', onMenuKeyDown, true);
    if (wasOpen && fromPop !== true && UM.layers) UM.layers.release('menu', !!noBack);
  }

  document.addEventListener('click', function (e) {
    if (activeMenuEl && !activeMenuEl.contains(e.target)) {
      closeMenu();
    }
  });

  function menu(anchorOrPoint, items) {
    closeMenu();
    var m = h('div', { className: 'um-menu' });

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.separator) {
        m.appendChild(h('div', { className: 'um-menu-sep' }));
      } else if (it.label) {
        m.appendChild(h('div', { className: 'um-menu-label', text: it.label }));
      } else {
        (function (item) {
          var row = h('button', {
            className: 'um-menu-item' + (item.danger ? ' um-menu-item--danger' : ''),
            onClick: function (e) {
              e.stopPropagation();
              closeMenu(false, true); // the action may navigate; keep history intact
              if (item.action) item.action();
            }
          });
          if (item.icon) {
            row.appendChild(h('span', { html: item.icon }));
          }
          row.appendChild(h('span', { text: item.text }));
          m.appendChild(row);
        })(it);
      }
    }

    /* Position calculation: on phone layout, CSS overrides to bottom-sheet */
    var x = 0;
    var y = 0;
    if (anchorOrPoint && typeof anchorOrPoint.clientX === 'number') {
      x = anchorOrPoint.clientX;
      y = anchorOrPoint.clientY;
    } else if (anchorOrPoint && anchorOrPoint.getBoundingClientRect) {
      var rect = anchorOrPoint.getBoundingClientRect();
      x = rect.left;
      y = rect.bottom + 4;
    } else if (anchorOrPoint && typeof anchorOrPoint.x === 'number') {
      x = anchorOrPoint.x;
      y = anchorOrPoint.y;
    }

    if (!isPhone()) {
      m.style.left = Math.min(x, Math.max(10, window.innerWidth - 240)) + 'px';
      m.style.top = Math.min(y, Math.max(10, window.innerHeight - 340)) + 'px';
    }

    document.body.appendChild(m);
    activeMenuEl = m;
    if (UM.layers) UM.layers.push('menu', function () { closeMenu(true); });
    document.addEventListener('keydown', onMenuKeyDown, true);
    return m;
  }

  function dialog(opts) {
    opts = opts || {};
    var closed = false;
    var scrim = h('div', { className: 'um-dialog-scrim' });
    var dlg = h('div', { className: 'um-dialog' });

    if (opts.title) {
      dlg.appendChild(h('h3', { className: 'um-dialog-title', text: opts.title }));
    }
    if (opts.text) {
      dlg.appendChild(h('p', { className: 'um-dialog-text', text: opts.text }));
    }
    if (opts.body) {
      if (Array.isArray(opts.body)) {
        for (var bi = 0; bi < opts.body.length; bi++) dlg.appendChild(opts.body[bi]);
      } else if (opts.body.nodeType) {
        dlg.appendChild(opts.body);
      }
    }

    var actionsRow = h('div', { className: 'um-dialog-actions' });
    var actions = opts.actions || [
      { text: 'Close', primary: true, onClick: function (close) { close(); } }
    ];

    var layerName = 'dialog-' + Math.random().toString(36).slice(2, 8);
    function close(fromPop) {
      if (closed) return;
      closed = true;
      if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
      if (fromPop !== true && UM.layers) UM.layers.release(layerName);
      document.removeEventListener('keydown', onKeyDown, true);
      if (typeof opts.onClose === 'function') {
        try { opts.onClose(); } catch (e) { console.error(e); }
      }
    }

    for (var ai = 0; ai < actions.length; ai++) {
      (function (act) {
        var btn = h('button', {
          className: 'um-btn' + (act.primary ? ' um-btn--accent' : ' um-btn--ghost'),
          text: act.text,
          onClick: function () {
            if (act.onClick) act.onClick(close);
            else close();
          }
        });
        actionsRow.appendChild(btn);
      })(actions[ai]);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        close();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);

    scrim.addEventListener('mousedown', function (e) {
      if (e.target === scrim) close();
    });

    dlg.appendChild(actionsRow);
    scrim.appendChild(dlg);
    document.body.appendChild(scrim);
    if (UM.layers) UM.layers.push(layerName, function () { close(true); });
    return { close: close, element: dlg };
  }

  function prompt(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var settled = false;
      function finish(v) {
        if (settled) return;
        settled = true;
        resolve(v);
      }

      var inputEl = h('input', {
        className: 'um-dialog-input',
        type: opts.type || 'text',
        value: opts.value || '',
        placeholder: opts.placeholder || ''
      });

      var dlgObj = dialog({
        title: opts.title || 'Prompt',
        text: opts.text || '',
        body: inputEl,
        onClose: function () { finish(null); },
        actions: [
          {
            text: opts.cancelText || 'Cancel',
            onClick: function (close) { close(); }
          },
          {
            text: opts.okText || 'OK',
            primary: true,
            onClick: function (close) {
              var val = inputEl.value.trim();
              finish(val);
              close();
            }
          }
        ]
      });

      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var val = inputEl.value.trim();
          finish(val);
          dlgObj.close();
        } else if (e.key === 'Escape') {
          finish(null);
        }
      });
      setTimeout(function () { inputEl.focus(); inputEl.select(); }, 40);
    });
  }

  function confirm(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var settled = false;
      function finish(v) {
        if (settled) return;
        settled = true;
        resolve(v);
      }

      dialog({
        title: opts.title || 'Confirm',
        text: opts.text || '',
        onClose: function () { finish(false); },
        actions: [
          {
            text: opts.cancelText || 'Cancel',
            onClick: function (close) { close(); }
          },
          {
            text: opts.okText || 'OK',
            primary: true,
            onClick: function (close) {
              finish(true);
              close();
            }
          }
        ]
      });
    });
  }

  function skeleton(kind, n) {
    n = n || 1;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < n; i++) {
      if (kind === 'card') {
        var cardEl = h('div', { className: 'um-skel um-skel-card' },
          h('div', { className: 'um-skel-art' }),
          h('div', { className: 'um-skel-line um-skel-line--md' }),
          h('div', { className: 'um-skel-line um-skel-line--sm' })
        );
        frag.appendChild(cardEl);
      } else if (kind === 'tile') {
        frag.appendChild(h('div', { className: 'um-skel um-skel-tile' }));
      } else {
        frag.appendChild(h('div', { className: 'um-skel um-skel-line um-skel-line--md' }));
      }
    }
    return frag;
  }

  function nav(hash) {
    if (!hash) return;
    if (hash.charAt(0) !== '#') hash = '#' + hash;
    window.location.hash = hash;
  }

  /* ------------------------------------------------------------------ *
   * Shared Builders: Track Row & Track List
   * ------------------------------------------------------------------ */
  function isInteractiveTarget(target, boundary) {
    var el = target;
    while (el && el !== boundary) {
      var tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' ||
        (el.getAttribute && el.getAttribute('role') === 'button')) {
        return true;
      }
      el = el.parentNode;
    }
    return false;
  }

  function trackRowMenu(e, track, opts) {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    opts = opts || {};
    var liked = isLiked(track.id);
    var source = opts.source || null;

    var menuItems = [
      {
        text: 'Play next',
        icon: icon('play'),
        action: function () {
          if (UM.player) {
            UM.player.addNext(track);
            toast('Playing next');
          }
        }
      },
      {
        text: 'Add to queue',
        icon: icon('queue'),
        action: function () {
          if (UM.player) {
            UM.player.addToQueue(track);
            toast('Added to queue');
          }
        }
      },
      {
        text: liked ? 'Remove from Liked' : 'Save to Liked Songs',
        icon: liked ? icon('heartFill') : icon('heart'),
        action: function () { toggleLike(track, source); }
      },
      {
        text: 'Start radio',
        icon: icon('radio'),
        action: function () {
          if (UM.player) {
            UM.player.playOne(track);
            toast('Starting radio for ' + (track.title || 'track'));
          }
        }
      },
      { separator: true },
      { label: 'Add to playlist' },
      {
        text: 'New playlist…',
        icon: icon('plus'),
        action: function () {
          prompt({ title: 'New playlist', placeholder: 'Playlist name' }).then(function (name) {
            if (!name) return;
            var pl = createPlaylist(name);
            if (pl) addToPlaylist(pl.id, track);
          });
        }
      }
    ];

    var pls = libState.playlists || [];
    for (var p = 0; p < pls.length; p++) {
      (function (pl) {
        menuItems.push({
          text: pl.name,
          icon: icon('note'),
          action: function () { addToPlaylist(pl.id, track); }
        });
      })(pls[p]);
    }

    menuItems.push({ separator: true });

    if (track.albumId) {
      menuItems.push({
        text: 'Go to album',
        icon: icon('note'),
        action: function () { nav('#/album/' + encodeURIComponent(track.albumId)); }
      });
    }
    if (track.artistId) {
      menuItems.push({
        text: 'Go to artist',
        icon: icon('note'),
        action: function () { nav('#/artist/' + encodeURIComponent(track.artistId)); }
      });
    }

    menuItems.push({
      text: 'Not interested',
      icon: icon('trash'),
      action: function () {
        feedback('not_interested', track, { source: source || 'library' });
        toast('Marked as not interested');
      }
    });

    if (opts.onRemove) {
      menuItems.push({ separator: true });
      menuItems.push({
        text: opts.removeText || 'Remove',
        icon: icon('trash'),
        danger: true,
        action: opts.onRemove
      });
    }

    menu(e, menuItems);
  }

  function trackRow(track, opts) {
    opts = opts || {};
    var list = (opts.list && opts.list.length) ? opts.list : [track];
    var idx = (typeof opts.index === 'number') ? opts.index : 0;
    var source = opts.source || null;
    var cur = (UM.player && typeof UM.player.current === 'function') ? UM.player.current() : null;
    var isCur = !!(cur && cur.id === track.id);

    function playThis() {
      if (opts.onPlayTrack) {
        opts.onPlayTrack(idx);
        return;
      }
      playTracks(list, idx, { source: source, auto: !!opts.auto });
    }

    var row = h('div', {
      className: 'um-track' + (isCur ? ' um-track--current' : ''),
      tabIndex: 0
    });
    row.dataset.trackId = track.id;
    row.dataset.displayIdx = String(idx + 1);

    /* Single activation path only: tap on touch, double-click on desktop.
     * A click handler is never installed alongside the double-click handler,
     * so a double-click can never start playback twice (which previously
     * toggled the transport and looked like a spontaneous pause). */
    /* Single click/tap plays (like Spotify). Clicks within 450 ms of the last
     * one are ignored so a double-click can't start the song twice. Clicking
     * the song that is already loaded toggles play/pause instead of restarting. */
    var lastTapAt = 0;
    row.addEventListener('click', function (e) {
      if (isInteractiveTarget(e.target, row)) return;
      var now = Date.now();
      if (now - lastTapAt < 450) { lastTapAt = now; return; }
      lastTapAt = now;
      var c = (UM.player && typeof UM.player.current === 'function') ? UM.player.current() : null;
      if (c && c.id === track.id && typeof UM.player.toggle === 'function') {
        UM.player.toggle();
        return;
      }
      playThis();
    });

    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target === row) {
        e.preventDefault();
        playThis();
      }
    });

    row.addEventListener('contextmenu', function (e) {
      trackRowMenu(e, track, {
        source: source,
        onRemove: opts.onRemove ? function () { opts.onRemove(idx, track); } : null,
        removeText: opts.removeText
      });
    });

    /* Index or Equalizer */
    var idxCell = h('div', { className: 'um-track-idx' });
    if (isCur) {
      idxCell.appendChild(h('div', { className: 'um-eq' },
        h('div', { className: 'um-eq-bar' }),
        h('div', { className: 'um-eq-bar' }),
        h('div', { className: 'um-eq-bar' })
      ));
    } else {
      idxCell.textContent = String(idx + 1);
    }
    row.appendChild(idxCell);

    /* Art */
    if (!opts.noArt) {
      row.appendChild(h('div', { className: 'um-track-art' },
        img(track.thumb || track.art, '')
      ));
    }

    /* Main stack: title + artists */
    var mainCell = h('div', { className: 'um-track-main' });
    mainCell.appendChild(h('div', { className: 'um-track-title', text: track.title || 'Untitled' }));
    var subSpan = h('div', { className: 'um-track-sub' });
    if (track.artistId) {
      subSpan.appendChild(h('a', {
        className: 'um-track-artists',
        href: '#/artist/' + encodeURIComponent(track.artistId),
        text: track.artists || 'Unknown',
        onClick: function (e) { e.stopPropagation(); }
      }));
    } else {
      subSpan.textContent = track.artists || '';
    }
    mainCell.appendChild(subSpan);
    row.appendChild(mainCell);

    /* Album column (hidden on narrow screens via CSS) */
    var albumCell = h('div', { className: 'um-track-album' });
    if (track.album) {
      if (track.albumId) {
        albumCell.appendChild(h('a', {
          href: '#/album/' + encodeURIComponent(track.albumId),
          text: track.album,
          onClick: function (e) { e.stopPropagation(); }
        }));
      } else {
        albumCell.textContent = track.album;
      }
    }
    row.appendChild(albumCell);

    /* Duration */
    row.appendChild(h('div', { className: 'um-track-time', text: fmtTime(track.duration) }));

    /* Actions: like + more */
    var actCell = h('div', { className: 'um-track-actions' });
    var likeBtn = h('button', {
      className: 'um-like' + (isLiked(track.id) ? ' um-like--on' : ''),
      html: isLiked(track.id) ? icon('heartFill') : icon('heart'),
      title: 'Like',
      'aria-label': 'Like',
      onClick: function (e) {
        e.stopPropagation();
        toggleLike(track, source);
        var likedNow = isLiked(track.id);
        likeBtn.classList.toggle('um-like--on', likedNow);
        likeBtn.innerHTML = likedNow ? icon('heartFill') : icon('heart');
      }
    });
    var moreBtn = h('button', {
      className: 'um-icon-btn',
      html: icon('more'),
      title: 'More',
      'aria-label': 'More options',
      onClick: function (e) {
        trackRowMenu(e, track, {
          source: source,
          onRemove: opts.onRemove ? function () { opts.onRemove(idx, track); } : null,
          removeText: opts.removeText
        });
      }
    });
    actCell.appendChild(likeBtn);
    actCell.appendChild(moreBtn);
    row.appendChild(actCell);

    return row;
  }

  function trackList(tracks, opts) {
    opts = opts || {};
    var container = h('div', {
      className: 'um-tracks' + (opts.noArt ? ' um-tracks--noart' : (opts.plain ? ' um-tracks--plain' : ''))
    });
    var list = tracks || [];
    for (var i = 0; i < list.length; i++) {
      container.appendChild(trackRow(list[i], Object.assign({}, opts, { index: i, list: list })));
    }
    return container;
  }

  /* ------------------------------------------------------------------ *
   * Shared Builders: Cards & Rows
   * ------------------------------------------------------------------ */
  function moodHash(item) {
    return '#/mood?params=' + encodeURIComponent(item.params || '') +
      '&title=' + encodeURIComponent(item.title || '');
  }

  function playKind(kind, item) {
    if (!item || !item.id) return;
    if (!UM.player) return;

    var path = null;
    if (kind === 'album') path = '/api/album/';
    else if (kind === 'artist') path = '/api/artist/';
    else if (kind === 'playlist') path = '/api/playlist/';
    else if (kind === 'mix') path = '/api/mix/';
    if (!path) return;

    var isRecommended = (kind === 'mix');
    var source = isRecommended ? ('mix:' + item.id) : kind;
    toast('Loading…');

    req(path + encodeURIComponent(item.id)).then(function (res) {
      var tracks = (res && (res.tracks || res.songs)) || [];
      tracks = tracks.filter(function (t) { return t && t.id; });
      if (!tracks.length) {
        toast('Nothing to play here', 'error');
        return;
      }
      playTracks(tracks, 0, { source: source, auto: isRecommended });
    }).catch(function (err) {
      toast((err && err.message) || 'Could not start playback', 'error');
    });
  }

  function card(item, kind) {
    item = item || {};
    kind = kind || 'album';

    if (kind === 'mix') return mixCard(item);
    if (kind === 'station') return stationCard(item);

    if (kind === 'mood') {
      return h('div', {
        className: 'um-card',
        onClick: function () { nav(moodHash(item)); }
      },
        h('div', { className: 'um-card-artwrap' },
          img(item.art, 'um-card-art'),
          h('button', {
            className: 'um-card-play',
            html: icon('play'),
            title: 'Open',
            onClick: function (e) {
              e.stopPropagation();
              nav(moodHash(item));
            }
          })
        ),
        h('div', { className: 'um-card-title', text: item.title || 'Mood' }),
        h('div', { className: 'um-card-sub', text: item.subtitle || 'Playlist' })
      );
    }

    var isArtist = kind === 'artist';

    var artWrap = h('div', {
      className: 'um-card-artwrap',
      style: isArtist ? 'border-radius:50%;overflow:hidden;' : ''
    },
      img(item.art || item.thumb, 'um-card-art'),
      h('button', {
        className: 'um-card-play',
        html: icon('play'),
        title: 'Play',
        'aria-label': 'Play',
        onClick: function (e) {
          e.stopPropagation();
          if (typeof item.onPlay === 'function') {
            item.onPlay();
          } else if (kind === 'track') {
            if (UM.player) UM.player.playOne(item);
          } else {
            playKind(kind, item);
          }
        }
      })
    );

    var titleEl = h('div', {
      className: 'um-card-title',
      style: isArtist ? 'text-align:center;' : '',
      text: item.title || item.name || 'Untitled'
    });

    var subEl = h('div', {
      className: 'um-card-sub',
      style: isArtist ? 'text-align:center;' : '',
      text: item.artists || item.author || (isArtist ? 'Artist' : (item.year || ''))
    });

    return h('div', {
      className: 'um-card',
      onClick: function () {
        if (typeof item.onClick === 'function') {
          item.onClick();
        } else if (kind === 'album') {
          nav('#/album/' + encodeURIComponent(item.id));
        } else if (kind === 'artist') {
          nav('#/artist/' + encodeURIComponent(item.id));
        } else if (kind === 'playlist') {
          nav('#/playlist/' + encodeURIComponent(item.id));
        } else if (kind === 'track' && UM.player) {
          UM.player.playOne(item);
        }
      }
    }, artWrap, titleEl, subEl);
  }

  function mixCard(mix, n) {
    mix = mix || {};
    var isDaily = mix.id && mix.id.indexOf('daily-') === 0;
    var isDaylist = mix.id === 'daylist';
    var num = isDaily ? mix.id.replace('daily-', '') : (n != null ? String(n) : '');
    if (num.length === 1) num = '0' + num;

    var covers = mix.covers || [];
    var artWrap = h('div', { className: 'um-card-artwrap' });

    if (covers.length >= 4) {
      artWrap.appendChild(h('div', { className: 'um-collage' },
        h('div', { className: 'um-collage-cell' }, img(covers[0], '')),
        h('div', { className: 'um-collage-cell' }, img(covers[1], '')),
        h('div', { className: 'um-collage-cell' }, img(covers[2], '')),
        h('div', { className: 'um-collage-cell' }, img(covers[3], ''))
      ));
    } else {
      artWrap.appendChild(img(covers[0] || (mix.tracks && mix.tracks[0] && mix.tracks[0].art), ''));
    }

    if (isDaily) {
      artWrap.appendChild(h('div', { className: 'um-daily-label', text: 'Daily Mix' }));
      artWrap.appendChild(h('div', { className: 'um-number-badge', text: num }));
    }
    if (isDaylist) {
      artWrap.appendChild(h('div', { className: 'um-daylist-tint' }));
      artWrap.appendChild(h('div', { className: 'um-daily-label um-daylist-label', text: 'daylist' }));
    }

    function start() {
      var tracks = (mix.tracks || []).filter(function (t) { return t && t.id; });
      if (tracks.length && UM.player) {
        playTracks(tracks, 0, { auto: true, source: 'mix:' + mix.id });
      } else {
        nav('#/mix/' + encodeURIComponent(mix.id));
      }
    }

    artWrap.appendChild(h('button', {
      className: 'um-card-play',
      html: icon('play'),
      title: 'Play',
      'aria-label': 'Play',
      onClick: function (e) {
        e.stopPropagation();
        start();
      }
    }));

    return h('div', {
      className: 'um-card um-card--mix',
      onClick: function () { nav('#/mix/' + encodeURIComponent(mix.id)); }
    },
      artWrap,
      h('div', { className: 'um-card-title', text: mix.title || 'Daily Mix' }),
      h('div', { className: 'um-card-sub', text: mix.subtitle || 'Personalized mix' })
    );
  }

  function playStationDirect(st) {
    if (!st || !st.seed) return;
    var fallback = {
      id: st.seed,
      title: st.title,
      artists: (st.title || '').replace(' Radio', ''),
      thumb: st.art,
      art: st.art
    };
    toast('Loading ' + (st.title || 'station') + '…');
    req('/api/radio/' + encodeURIComponent(st.seed))
      .then(function (res) {
        var tracks = ((res && res.tracks) || []).filter(function (t) { return t && t.id; });
        if (tracks.length && UM.player) {
          playTracks(tracks, 0, { auto: true, source: 'radio' });
        } else if (UM.player) {
          UM.player.playOne(fallback);
        }
      })
      .catch(function () {
        if (UM.player) UM.player.playOne(fallback);
      });
  }

  function stationCard(st) {
    st = st || {};
    var artWrap = h('div', { className: 'um-card-artwrap' },
      h('div', { className: 'um-radio-label', text: 'RADIO' }),
      h('div', { className: 'um-radio-art' }, img(st.art, '')),
      h('button', {
        className: 'um-card-play',
        html: icon('play'),
        title: 'Play',
        'aria-label': 'Play',
        onClick: function (e) {
          e.stopPropagation();
          playStationDirect(st);
        }
      })
    );

    return h('div', {
      className: 'um-card um-card--radio',
      onClick: function () { playStationDirect(st); }
    },
      artWrap,
      h('div', { className: 'um-card-title', text: st.title || 'Station' }),
      h('div', { className: 'um-card-sub', text: 'Artist Radio' })
    );
  }

  function shortcutTile(item) {
    item = item || {};
    var artNode = item.isLiked
      ? h('div', {
          className: 'um-lib-row-art--liked',
          style: 'width:100%;height:100%;display:grid;place-items:center;',
          html: icon('heartFill')
        })
      : img(item.art || item.thumb, '');

    return h('div', {
      className: 'um-shortcut',
      onClick: function () {
        if (typeof item.onClick === 'function') item.onClick();
      }
    },
      h('div', { className: 'um-shortcut-art' }, artNode),
      h('div', { className: 'um-shortcut-title', text: item.title || '' }),
      h('button', {
        className: 'um-shortcut-play',
        html: icon('play'),
        title: 'Play',
        'aria-label': 'Play',
        onClick: function (e) {
          e.stopPropagation();
          if (typeof item.onPlay === 'function') item.onPlay();
        }
      })
    );
  }

  function section(title, subtitle, items, opts) {
    opts = opts || {};
    var sec = h('div', { className: 'um-section' });
    var headRow = h('div', { className: 'um-section-head' });

    var titlesCol = h('div', {},
      h('h2', { className: 'um-section-title', text: title })
    );
    if (subtitle) {
      titlesCol.appendChild(h('p', { className: 'um-section-sub', text: subtitle }));
    }
    headRow.appendChild(titlesCol);

    if (opts.showAll) {
      headRow.appendChild(h('button', {
        className: 'um-section-all',
        text: 'Show all',
        onClick: opts.showAll
      }));
    }
    sec.appendChild(headRow);

    var scroller = h('div', { className: 'um-row' });
    if (Array.isArray(items)) {
      for (var i = 0; i < items.length; i++) {
        if (items[i] && items[i].nodeType) scroller.appendChild(items[i]);
      }
    }
    sec.appendChild(scroller);
    return sec;
  }

  /* ------------------------------------------------------------------ *
   * Module Exports (window.UM.core & window.UM.ui)
   * ------------------------------------------------------------------ */
  UM.core = {
    token: getToken,
    setToken: setToken,
    login: login,
    register: register,
    logout: logout,
    me: me,
    apiBase: getApiBase,
    setApiBase: setApiBase,

    lib: libState,
    loadLibrary: loadLibrary,
    loadCachedLibrary: loadCachedLibrary,
    streamQuality: streamQuality,
    prefetch: prefetch,
    saveLibrary: saveLibrary,
    isLiked: isLiked,
    toggleLike: toggleLike,
    addToPlaylist: addToPlaylist,
    createPlaylist: createPlaylist,
    createPlaylistWithTracks: createPlaylistWithTracks,
    renamePlaylist: renamePlaylist,
    deletePlaylist: deletePlaylist,
    recordHistory: recordHistory,
    feedback: feedback,

    on: on,
    off: off,
    emit: emit,

    onAuthRequired: null
  };

  UM.ui = {
    h: h,
    icon: icon,
    toast: toast,
    menu: menu,
    closeMenu: closeMenu,
    dialog: dialog,
    prompt: prompt,
    confirm: confirm,
    fmtTime: fmtTime,
    img: img,
    resizeArtUrl: resizeArtUrl,
    dominantColor: dominantColor,

    isIOS: isIOS,
    isTouch: isTouch,
    isPhone: isPhone,
    skeleton: skeleton,
    nav: nav,
    playTracks: playTracks,

    trackRow: trackRow,
    trackList: trackList,
    card: card,
    mixCard: mixCard,
    stationCard: stationCard,
    shortcutTile: shortcutTile,
    section: section
  };
})();
