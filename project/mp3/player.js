/* UTSHOW Music (web) — audio engine (UM.player)
 * Vanilla JS audio engine supporting iOS single-element background playback,
 * desktop dual-element crossfade, Media Session API, queue management,
 * gapless warm-up, automatic radio continuation, and feedback telemetry.
 *
 * Conforms to UTSHOW Music web spec (v1.2).
 * Resolves UM.streamUrl and UM.req lazily (core.js loads after player.js).
 * Multi-user aware: scopes sessions and occurrences to the authenticated user.
 */
(function () {
  'use strict';

  var UM = window.UM || (window.UM = {});

  /* ------------------------------------------------------------------ *
   * Platform Detection
   * ------------------------------------------------------------------ */
  var isIOS = (function () {
    if (typeof navigator === 'undefined') return false;
    var ua = navigator.userAgent || '';
    var platform = navigator.platform || '';
    var maxTouch = navigator.maxTouchPoints || 0;
    return /iP(hone|ad|od)/.test(ua) || (platform === 'MacIntel' && maxTouch > 1);
  })();

  /* ------------------------------------------------------------------ *
   * Constants & Defaults
   * ------------------------------------------------------------------ */
  var FEEDBACK_PATH = '/api/feedback';
  var RADIO_PATH = '/api/radio/';
  var STREAM_PATH = '/api/stream/';
  var SESSION_PREFIX = 'um.session.';
  var SESSION_FALLBACK = 'um.session';
  var SESSION_INTERVAL = 5000;
  var STATE_THROTTLE = 250;       // <= 4 state updates/sec during continuous playback
  var PLAY_THRESHOLD = 30;        // seconds of real listening for positive feedback
  var PLAY_FRACTION = 0.5;        // or 50% of track duration
  var WARMUP_WINDOW = 20;         // seconds before end to pre-resolve next stream
  var SESSION_WINDOW = 300;       // maximum tracks retained across localStorage session
  var REPEAT_MODES = ['off', 'all', 'one'];

  /* ------------------------------------------------------------------ *
   * User Identity & Credentials
   * ------------------------------------------------------------------ */
  function getCurrentUser() {
    if (UM.core && typeof UM.core.me === 'function') {
      var u = UM.core.me();
      if (u) return u;
    }
    try {
      var raw = localStorage.getItem('um.user');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function getCurrentUserId() {
    var u = getCurrentUser();
    if (u && u.id) return String(u.id);
    if (u && u.name) return String(u.name);
    var tok = getStoredToken();
    if (tok) {
      var parts = tok.split('.');
      if (parts.length >= 2 && parts[0]) return parts[0];
    }
    return '';
  }

  function getSessionKey(uid) {
    var id = (typeof uid === 'string') ? uid : getCurrentUserId();
    return id ? (SESSION_PREFIX + id) : SESSION_FALLBACK;
  }

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

  function getStoredToken() {
    try {
      return localStorage.getItem('um.token') || '';
    } catch (e) {
      return '';
    }
  }

  function resolveStreamUrl(id, bust, token) {
    var url = '';
    if (typeof UM.streamUrl === 'function' && !token) {
      url = UM.streamUrl(id);
    } else {
      var base = getApiBase();
      var path = STREAM_PATH + encodeURIComponent(id);
      url = (base ? base + path : path);
      var tok = token || getStoredToken();
      if (tok) url += '?t=' + encodeURIComponent(tok);
    }
    if (bust) {
      url += (url.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
    }
    return url;
  }

  function requestJson(path, opts) {
    opts = opts || {};
    var base = getApiBase();
    var fullUrl = (/^https?:\/\//i.test(path)) ? path : (base ? base + path : path);
    var headers = Object.assign({}, opts.headers || {});
    var tok = opts.token || getStoredToken();
    if (tok && !headers['Authorization']) {
      headers['Authorization'] = 'Bearer ' + tok;
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
      if (!r.ok) {
        return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }).then(function (e) {
          throw new Error(e.error || ('Request failed (' + r.status + ')'));
        });
      }
      return r.json();
    });
  }

  /* Normalised "artist|title" identity (mirrors SongIdentity.kt and recommender.py) */
  function songKey(track) {
    if (!track) return '';
    var artist = String(track.artists || '').split(',')[0] || '';
    artist = artist
      .toLowerCase()
      .replace(/\s*-\s*topic\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    var title = String(track.title || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    return artist + '|' + title;
  }

  /* ------------------------------------------------------------------ *
   * Artwork URL Generator
   * ------------------------------------------------------------------ */
  function resizeArt(url, size) {
    if (!url) return '';
    if (url.indexOf('=') >= 0 && /=w\d+-h\d+/i.test(url)) {
      return url.replace(/=w\d+-h\d+[^"]*/i, '=w' + size + '-h' + size + '-l90-rj');
    }
    return url;
  }

  /* ------------------------------------------------------------------ *
   * Event Bus
   * ------------------------------------------------------------------ */
  var listeners = Object.create(null);

  function on(ev, fn) {
    if (typeof fn !== 'function' || !ev) return;
    if (!listeners[ev]) listeners[ev] = new Set();
    listeners[ev].add(fn);
  }

  function off(ev, fn) {
    var s = listeners[ev];
    if (s) s.delete(fn);
  }

  function emit(ev, data) {
    var s = listeners[ev];
    if (!s || !s.size) return;
    var list = Array.from(s);
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](data);
      } catch (e) {
        console.error('[UM.player] Listener error for "' + ev + '":', e);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Utilities
   * ------------------------------------------------------------------ */
  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function num(v, def) {
    return (typeof v === 'number' && isFinite(v)) ? v : def;
  }

  function nowMs() {
    return (window.performance && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  }

  function shuffleArray(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /* ------------------------------------------------------------------ *
   * State Definition
   * ------------------------------------------------------------------ */
  var state = {
    queue: [],
    index: -1,
    original: [],
    shuffle: false,
    repeat: 'off',
    volume: 0.8,
    crossfade: isIOS ? 0 : 0,
    playing: false,
    position: 0,
    duration: 0,
    buffering: false,
    needsGesture: false,
    error: null
  };

  var queueGen = 0;             // Increments on structural queue replacement
  var continuationGen = 0;      // Guard for auto-extension / radio continuation
  var failedIds = new Set();    // Track IDs that failed playback in current playback cycle
  var warmupMap = new Map();    // Cached warmed-up track IDs
  var xfade = null;             // Active crossfade state descriptor
  var activeUserId = getCurrentUserId();

  /* ------------------------------------------------------------------ *
   * Audio Slots (Dual-element on Desktop, Strictly Single on iOS)
   * ------------------------------------------------------------------ */
  function createSlot(idName) {
    var el = document.createElement('audio');
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
    el.style.display = 'none';
    return {
      idName: idName,
      el: el,
      track: null,
      auto: false,
      token: '',
      userId: '',
      loadGen: 0,
      playedReported: false,
      retried: false,
      prefetchFor: null,
      ignoreEnd: false,
      listened: 0,
      lastPos: 0,
      lastWallTime: 0,
      isSeeking: false
    };
  }

  /* Two elements everywhere. On iOS the second one is only used by the
     opt-in crossfade test; normal song changes stay on one element so
     background playback keeps working. */
  var slots = [createSlot('A'), createSlot('B')];

  /* iOS ignores el.volume, so the iPhone crossfade test sends audio through
     Web Audio gain nodes. Only switched on when crossfade > 0 on iOS. */
  var actx = null;
  function iosXfadeOn() { return isIOS && state.crossfade > 0; }
  function ensureActx() {
    if (actx) return actx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { actx = new AC(); } catch (e) { actx = null; }
    if (actx) {
      claimAudioSession();
      actx.onstatechange = function () {
        if (actx.state === 'interrupted' && state.playing) pause();
      };
    }
    return actx;
  }
  function resumeActx() {
    if (actx && actx.state !== 'running' && actx.state !== 'interrupted') { try { actx.resume(); } catch (e) {} }
  }

  /* Phone interruptions (2026-11-12).
     iOS: Web Audio on its own gets the 'ambient' audio session, which mixes with
     calls instead of being interrupted, so music kept playing during a video call.
     Ask for a real 'playback' session, and pause when iOS reports an interruption.
     Android: a notification can make the browser pause us without resuming. If a
     pause did not come from the user, try to resume a few seconds later. */
  function claimAudioSession() {
    try {
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
    } catch (e) {}
  }
  claimAudioSession();
  var lastUserPause = 0, lastDeviceChange = 0, sysPause = null;
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', function () { lastDeviceChange = nowMs(); });
    }
  } catch (e) {}
  function noteSystemPause(slot) {
    if (isIOS) return;
    var t = nowMs(), el = slot.el;
    if (t - lastUserPause < 1500 || t - (slot.loadedAt || 0) < 1500) return;
    if (el.ended || (el.duration && el.currentTime >= el.duration - 1)) return;
    if (t - lastDeviceChange < 2000) return;   /* headphones unplugged: stay paused */
    var mine = sysPause = { at: t };
    [2500, 6000, 12000].forEach(function (ms) {
      setTimeout(function () {
        if (sysPause !== mine || slots[active] !== slot || !slot.el.paused) return;
        if (lastDeviceChange >= mine.at - 2000 || lastUserPause > mine.at) { sysPause = null; return; }
        try {
          var pr = slot.el.play();
          if (pr && pr.catch) pr.catch(function () {});
        } catch (e) {}
      }, ms);
    });
  }
  /* Must run before a new src is set (the media has to load with CORS). */
  function routeSlot(slot) {
    if (slot.gain || !iosXfadeOn()) return;
    var ctx = ensureActx();
    if (!ctx || ctx.state !== 'running') return;
    try {
      slot.el.crossOrigin = 'anonymous';
      var src = ctx.createMediaElementSource(slot.el);
      var g = ctx.createGain();
      g.gain.value = state.volume;
      src.connect(g);
      g.connect(ctx.destination);
      slot.gain = g;
    } catch (e) {}
  }
  function setElVol(slot, v) {
    v = clamp(num(v, 0), 0, 1);
    if (slot.gain) {
      try { slot.gain.gain.cancelScheduledValues(0); slot.gain.gain.value = v; } catch (e) {}
      try { slot.el.volume = 1; } catch (e) {}
    } else {
      try { slot.el.volume = v; } catch (e) {}
    }
  }
  function xfadeAllowed() {
    if (!isIOS) return true;
    return iosXfadeOn() && !document.hidden && !!actx && actx.state === 'running' && !!slots[active].gain;
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) resumeActx(); });
  var active = 0;

  function attachElements() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', attachElements, { once: true });
      return;
    }
    for (var i = 0; i < slots.length; i++) {
      if (!slots[i].el.parentNode) document.body.appendChild(slots[i].el);
    }
  }

  function activeSlot() {
    return slots[active];
  }

  function current() {
    if (state.index < 0 || state.index >= state.queue.length) return null;
    return state.queue[state.index] || null;
  }

  function snapshot() {
    return {
      queue: state.queue.slice(),
      index: state.index,
      original: state.original.slice(),
      shuffle: state.shuffle,
      repeat: state.repeat,
      volume: state.volume,
      muted: state.volume <= 0.0001,
      crossfade: state.crossfade,
      playing: state.playing,
      position: state.position,
      duration: state.duration,
      buffering: state.buffering,
      needsGesture: state.needsGesture,
      error: state.error,
      track: current()
    };
  }

  /* ------------------------------------------------------------------ *
   * Throttled State Emission
   * ------------------------------------------------------------------ */
  var lastEmitAt = 0;
  var emitTimer = null;

  function emitState(throttle) {
    var t = nowMs();
    if (!throttle) {
      lastEmitAt = t;
      if (emitTimer) { clearTimeout(emitTimer); emitTimer = null; }
      emit('state', snapshot());
      return;
    }
    var elapsed = t - lastEmitAt;
    if (elapsed >= STATE_THROTTLE) {
      lastEmitAt = t;
      if (emitTimer) { clearTimeout(emitTimer); emitTimer = null; }
      emit('state', snapshot());
      return;
    }
    if (!emitTimer) {
      emitTimer = setTimeout(function () {
        emitTimer = null;
        lastEmitAt = nowMs();
        emit('state', snapshot());
      }, Math.max(16, STATE_THROTTLE - elapsed));
    }
  }

  /* ------------------------------------------------------------------ *
   * Telemetry Feedback (Online Ranker & Logging)
   * ------------------------------------------------------------------ */
  function sendFeedback(kind, track, listenedSec, duration, auto, token) {
    if (!track || !track.id || !kind) return;
    var payload = {
      id: track.id,
      track: track,
      kind: kind,
      auto: !!auto,
      listenedSec: Math.max(0, Math.round(listenedSec || 0)),
      duration: Math.max(0, Math.round(duration || track.duration || 0))
    };
    try {
      requestJson(FEEDBACK_PATH, {
        method: 'POST',
        body: payload,
        token: token,
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  function isPositivePlay(listened, dur) {
    if (listened >= PLAY_THRESHOLD) return true;
    return dur > 0 && listened >= dur * PLAY_FRACTION;
  }

  /* ------------------------------------------------------------------ *
   * Slot Lifecycle & State Tracking
   * ------------------------------------------------------------------ */
  function resetSlotMetrics(slot, track, auto) {
    slot.track = track;
    slot.auto = !!auto;
    slot.token = getStoredToken();
    slot.userId = getCurrentUserId();
    slot.loadGen++;
    slot.playedReported = false;
    slot.listened = 0;
    slot.lastPos = 0;
    slot.lastWallTime = nowMs();
    slot.isSeeking = false;
    slot.ignoreEnd = false;
    return slot.loadGen;
  }

  function loadSlot(slot, track, opts) {
    opts = opts || {};
    var canReuse = !opts.bust && slot.prefetchFor === track.id && !!slot.el.getAttribute('src');
    var gen = resetSlotMetrics(slot, track, (track && track._auto != null) ? track._auto : opts.auto);
    slot.retried = !!opts.bust;
    slot.prefetchFor = null;

    if (!canReuse) {
      routeSlot(slot);
      try {
        slot.loadedAt = nowMs();
        slot.el.src = resolveStreamUrl(track.id, !!opts.bust, slot.token);
      } catch (e) {}
    }
    setElVol(slot, (opts.volume != null) ? opts.volume : state.volume);
    return gen;
  }

  function stopSlot(slot) {
    slot.track = null;
    slot.auto = false;
    slot.token = '';
    slot.userId = '';
    slot.loadGen++;
    slot.playedReported = false;
    slot.retried = false;
    slot.prefetchFor = null;
    slot.ignoreEnd = false;
    slot.listened = 0;
    slot.lastPos = 0;
    slot.lastWallTime = 0;
    slot.isSeeking = false;
    try { slot.el.pause(); } catch (e) {}
    try {
      slot.el.removeAttribute('src');
      slot.el.load();
    } catch (e) {}
    setElVol(slot, state.volume);
  }

  function playSlot(slot, at, onReject) {
    var el = slot.el;
    if (iosXfadeOn()) { ensureActx(); resumeActx(); }
    if (!el.getAttribute('src') && slot.track) {
      loadSlot(slot, slot.track, { auto: slot.auto });
    }
    if (at != null) {
      try { el.currentTime = at; } catch (e) {}
      slot.lastPos = at;
      slot.lastWallTime = nowMs();
    }
    var captureGen = slot.loadGen;
    var p;
    try {
      p = el.play();
    } catch (e) {
      if (slot.loadGen === captureGen) {
        if (typeof onReject === 'function') onReject(e);
        handlePlayRejection(slot, e);
      }
      return;
    }
    if (p && typeof p.catch === 'function') {
      p.catch(function (err) {
        if (slot.loadGen !== captureGen) return;
        if (!err || err.name === 'AbortError') return;
        if (typeof onReject === 'function') onReject(err);
        handlePlayRejection(slot, err);
      });
    }
  }

  function handlePlayRejection(slot, err) {
    if (activeSlot() !== slot) return;
    if (err && err.name === 'NotAllowedError') {
      state.playing = false;
      state.buffering = false;
      state.needsGesture = true;
      emitState(false);
    }
  }

  function reportOccurrence(slot, reason) {
    var t = slot.track;
    if (!t) return;
    var listened = Math.max(0, slot.listened || 0);
    var dur = num(t.duration, 0) || num(slot.el.duration, 0);

    if (!slot.playedReported) {
      if (isPositivePlay(listened, dur)) {
        slot.playedReported = true;
        sendFeedback('play', t, listened, dur, slot.auto, slot.token);
        emit('played', t);
      } else if (reason !== 'ended') {
        sendFeedback('skip', t, listened, dur, slot.auto, slot.token);
      }
    }
    slot.playedReported = false;
  }

  function finalizeSlot(slot, reason) {
    if (!slot.track) return;
    reportOccurrence(slot, reason);
    slot.track = null;
    slot.auto = false;
    slot.token = '';
    slot.userId = '';
    slot.listened = 0;
    slot.lastPos = 0;
    slot.lastWallTime = 0;
    slot.isSeeking = false;
  }

  function accumulateListening(slot) {
    var el = slot.el;
    var cur = num(el.currentTime, 0);
    var now = nowMs();

    if (slot.isSeeking || el.seeking || el.paused) {
      slot.lastPos = cur;
      slot.lastWallTime = now;
      return;
    }

    var posDelta = cur - slot.lastPos;
    var wallDelta = slot.lastWallTime > 0 ? (now - slot.lastWallTime) / 1000 : 0;
    slot.lastPos = cur;
    slot.lastWallTime = now;

    if (posDelta <= 0) return;

    /* Genuine playback verification:
     * In background tabs, timeupdate may be throttled to 5-10s+.
     * If posDelta is reasonably consistent with wall-clock time passed,
     * count the playback rather than discarding it as a seek.
     */
    var maxAllowableDelta = Math.max(3.0, (wallDelta * 2.0) + 1.0);
    if (posDelta <= maxAllowableDelta) {
      slot.listened += posDelta;
    }
  }

  /* ------------------------------------------------------------------ *
   * Dynamic Volume Crossfade Engine (Non-iOS Only)
   * ------------------------------------------------------------------ */
  function applyFadeVolumes(p) {
    if (!xfade || xfade.ramped) return;
    var master = state.volume;
    setElVol(xfade.out, master * (1 - p));
    setElVol(xfade.into, master * p);
  }

  function fadeProgress() {
    if (!xfade || !xfade.durMs) return 1;
    return clamp(xfade.elapsed / xfade.durMs, 0, 1);
  }

  function tickFade() {
    if (!xfade) return;
    var t = nowMs();
    if (xfade.paused) {
      xfade.lastTick = t;
      return;
    }
    xfade.elapsed += Math.max(0, t - xfade.lastTick);
    xfade.lastTick = t;
    var p = fadeProgress();
    applyFadeVolumes(p);
    if (p >= 1) finishCrossfade('ended');
  }

  function startFadeRamp() {
    if (!xfade || xfade.started) return;
    xfade.started = true;
    xfade.elapsed = 0;
    xfade.lastTick = nowMs();
    /* iOS gain path: schedule the fade on the audio clock so it still
       finishes if timers get throttled. */
    if (xfade.out.gain && xfade.into.gain && actx) {
      try {
        var t0 = actx.currentTime, d = xfade.durMs / 1000, m = state.volume;
        var go = xfade.out.gain.gain, gi = xfade.into.gain.gain;
        go.cancelScheduledValues(t0); go.setValueAtTime(go.value, t0); go.linearRampToValueAtTime(0, t0 + d);
        gi.cancelScheduledValues(t0); gi.setValueAtTime(0, t0); gi.linearRampToValueAtTime(m, t0 + d);
        xfade.ramped = true;
      } catch (e) {}
    }
    if (xfade.iv) clearInterval(xfade.iv);
    xfade.iv = setInterval(tickFade, 50);
  }

  function finishCrossfade(reason) {
    if (!xfade) return;
    var x = xfade;
    xfade = null;
    if (x.iv) clearInterval(x.iv);

    if (reason === 'incoming-failed') {
      /* Revert active slot to outgoing if crossfade failed */
      if (x.out && x.out.track) {
        active = (slots[0] === x.out) ? 0 : 1;
        state.index = x.origIndex;
        setElVol(x.out, state.volume);
      }
      if (x.into) stopSlot(x.into);
      return;
    }

    if (x.out) {
      x.out.ignoreEnd = false;
      reportOccurrence(x.out, reason === 'skip' ? 'skip' : 'ended');
      stopSlot(x.out);
    }
    if (x.into) {
      setElVol(x.into, state.volume);
      /* If the incoming element already ended during the fade, advance safely */
      if (x.into.el.ended && activeSlot() === x.into) {
        setTimeout(function () { advance(true); }, 20);
      }
    }
  }

  function beginCrossfade(outSlot, nextIdx) {
    if (!xfadeAllowed()) return;
    var track = state.queue[nextIdx];
    if (!track || !track.id) return;
    if (xfade) finishCrossfade('ended');

    var inSlot = slots[1 - active];
    var origIdx = state.index;

    active = 1 - active;
    state.index = nextIdx;
    state.position = 0;
    state.duration = num(track.duration, 0);
    state.error = null;
    state.buffering = false;
    outSlot.ignoreEnd = true;

    loadSlot(inSlot, track, { volume: 0 });

    xfade = {
      out: outSlot,
      into: inSlot,
      origIndex: origIdx,
      iv: 0,
      started: false,
      elapsed: 0,
      lastTick: nowMs(),
      durMs: Math.max(200, (state.crossfade || 0) * 1000),
      paused: false
    };

    playSlot(inSlot, 0, function (err) {
      if (err && err.name === 'NotAllowedError') {
        if (xfade && xfade.into === inSlot) {
          finishCrossfade('incoming-failed');
          try { outSlot.el.pause(); } catch (e) {}
          state.playing = false;
          state.buffering = false;
          state.needsGesture = true;
          emitState(false);
        }
      }
    });

    emit('track', track);
    emitState(false);
  }

  function maybeStartCrossfade(slot) {
    if (!xfadeAllowed()) return;
    if (xfade) return;
    if (!state.playing) return;
    if (!state.crossfade || state.crossfade <= 0) return;
    var el = slot.el;
    var d = num(el.duration, 0);
    if (d <= 0) return;
    var remaining = d - num(el.currentTime, 0);
    if (remaining > state.crossfade || remaining <= 0.2) return;
    var ni = nextIndex(false);
    if (ni == null || ni === state.index) return;
    if (!state.queue[ni]) return;
    beginCrossfade(slot, ni);
  }

  /* ------------------------------------------------------------------ *
   * Warm-up & Prefetching
   * ------------------------------------------------------------------ */
  function warmUpNextStream(trackId) {
    if (!trackId || warmupMap.has(trackId)) return;
    warmupMap.set(trackId, Date.now());
    var url = resolveStreamUrl(trackId, false);
    try {
      fetch(url, { headers: { 'Range': 'bytes=0-1' } }).catch(function () {});
    } catch (e) {}
  }

  function maybeWarmup(slot) {
    var el = slot.el;
    var d = num(el.duration, 0);
    if (d <= 0) return;
    var remaining = d - num(el.currentTime, 0);
    if (remaining > WARMUP_WINDOW || remaining <= 0) return;

    var ni = nextIndex(false);
    if (ni == null || ni === state.index) return;
    var track = state.queue[ni];
    if (!track || !track.id) return;

    warmUpNextStream(track.id);

    /* On desktop with dual slots, also pre-set src on the idle element */
    if (!isIOS && slots.length > 1 && !xfade) {
      var idle = slots[1 - active];
      if (!idle.track && idle.prefetchFor !== track.id) {
        idle.prefetchFor = track.id;
        try {
          idle.el.preload = 'auto';
          idle.el.src = resolveStreamUrl(track.id, false);
        } catch (e) {}
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Media Session API
   * ------------------------------------------------------------------ */
  var lastPosReport = 0;

  function updateMetadata(track) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (typeof MediaMetadata === 'undefined') return;
    if (!track) {
      try { navigator.mediaSession.metadata = null; } catch (e) {}
      return;
    }

    var rawArt = track.art || track.thumb || '';
    var artwork = [];
    if (rawArt) {
      artwork.push({ src: resizeArt(rawArt, 96), sizes: '96x96', type: 'image/jpeg' });
      artwork.push({ src: resizeArt(rawArt, 192), sizes: '192x192', type: 'image/jpeg' });
      artwork.push({ src: resizeArt(rawArt, 512), sizes: '512x512', type: 'image/jpeg' });
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || '',
        artist: track.artists || '',
        album: track.album || '',
        artwork: artwork
      });
    } catch (e) {}
  }

  function updatePlaybackState() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState =
        state.playing ? 'playing' : (current() ? 'paused' : 'none');
    } catch (e) {}
  }

  function updatePositionState(force) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== 'function') return;
    var t = nowMs();
    if (!force && t - lastPosReport < 4500) return;
    lastPosReport = t;
    var d = state.duration;
    if (!isFinite(d) || d <= 0) return;
    var pos = clamp(state.position || 0, 0, Math.max(0, d - 0.05));
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: 1,
        position: pos
      });
    } catch (e) {}
  }

  function initMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    var ms = navigator.mediaSession;
    function setHandler(action, fn) {
      try { ms.setActionHandler(action, fn); } catch (e) {}
    }
    setHandler('play', function () { play(); });
    setHandler('pause', function () { pause(); });
    setHandler('stop', function () { stop(); });
    setHandler('previoustrack', function () { prev(); });
    setHandler('nexttrack', function () { next(); });
    setHandler('seekto', function (d) {
      if (d && typeof d.seekTime === 'number') seek(d.seekTime);
    });
    setHandler('seekbackward', function (d) {
      var ofs = (d && typeof d.seekOffset === 'number') ? d.seekOffset : 10;
      seek((state.position || 0) - ofs);
    });
    setHandler('seekforward', function (d) {
      var ofs = (d && typeof d.seekOffset === 'number') ? d.seekOffset : 10;
      seek((state.position || 0) + ofs);
    });
  }

  /* ------------------------------------------------------------------ *
   * Audio Element Event Wiring
   * ------------------------------------------------------------------ */
  function onTime(slot) {
    var el = slot.el;
    accumulateListening(slot);
    state.position = Math.max(0, num(el.currentTime, 0));
    var d = num(el.duration, 0);
    if (d > 0) state.duration = d;
    else if (slot.track) state.duration = num(slot.track.duration, state.duration);

    var t = slot.track;
    if (t && !slot.playedReported) {
      var dur = state.duration || num(t.duration, 0);
      if (isPositivePlay(slot.listened, dur)) {
        slot.playedReported = true;
        sendFeedback('play', t, slot.listened, dur, slot.auto, slot.token);
        emit('played', t);
      }
    }

    maybeStartCrossfade(slot);
    maybeWarmup(slot);
    updatePositionState(false);
    emitState(true);
  }

  function onError(slot) {
    var el = slot.el;
    if (!el.getAttribute('src')) return;
    var track = slot.track;
    if (!track) return;

    if (xfade && (xfade.into === slot || xfade.out === slot)) {
      finishCrossfade('ended');
    }

    /* Retry once with cache-buster timestamp */
    if (!slot.retried) {
      slot.retried = true;
      var pos = Math.max(0, num(el.currentTime, 0));
      var shouldPlay = state.playing || !el.paused;
      slot.prefetchFor = null;
      var curGen = ++slot.loadGen;
      try {
        slot.loadedAt = nowMs();
        el.src = resolveStreamUrl(track.id, true, slot.token);
      } catch (e) {}
      setElVol(slot, state.volume);
      if (pos > 0.3) {
        var onMeta = function () {
          el.removeEventListener('loadedmetadata', onMeta);
          if (slot.loadGen !== curGen || slot.track !== track) return;
          try {
            el.currentTime = pos;
            slot.lastPos = pos;
            slot.lastWallTime = nowMs();
          } catch (e) {}
        };
        el.addEventListener('loadedmetadata', onMeta);
      }
      if (shouldPlay) playSlot(slot, 0);
      return;
    }

    /* Second failure: register failure, emit error, advance safely */
    failedIds.add(track.id);
    var msg = 'Could not play "' + (track.title || track.id) + '".';
    state.error = msg;
    state.playing = false;
    state.buffering = false;
    emit('error', { track: track, message: msg });
    emitState(false);

    var failedSlot = slot;
    var genAtFail = queueGen;
    stopSlot(slot);

    setTimeout(function () {
      if (queueGen !== genAtFail) return;
      if (slots[active] !== failedSlot) return;
      if (failedSlot.track) return;
      advance(false, { skipFailed: true });
    }, 60);
  }

  function wireSlot(slot) {
    var el = slot.el;

    el.addEventListener('seeking', function () {
      slot.isSeeking = true;
    });

    el.addEventListener('seeked', function () {
      slot.isSeeking = false;
      slot.lastPos = num(el.currentTime, 0);
      slot.lastWallTime = nowMs();
    });

    el.addEventListener('timeupdate', function () {
      if (slots[active] === slot) onTime(slot);
      else if (slot.track) accumulateListening(slot);
    });

    el.addEventListener('loadedmetadata', function () {
      if (slots[active] !== slot) return;
      var d = num(el.duration, 0);
      if (d > 0) state.duration = d;
      updatePositionState(true);
      emitState(false);
    });

    el.addEventListener('durationchange', function () {
      if (slots[active] !== slot) return;
      var d = num(el.duration, 0);
      if (d > 0) state.duration = d;
      emitState(false);
    });

    el.addEventListener('ratechange', function () {
      if (slots[active] !== slot) return;
      updatePositionState(true);
    });

    el.addEventListener('play', function () {
      if (slots[active] !== slot) return;
      state.playing = true;
      state.needsGesture = false;
      emitState(false);
    });

    el.addEventListener('playing', function () {
      if (xfade && xfade.into === slot && !xfade.started) startFadeRamp();
      if (slots[active] !== slot) return;
      sysPause = null;
      state.playing = true;
      state.buffering = false;
      state.needsGesture = false;
      state.error = null;
      if (!state.duration) state.duration = slot.track ? num(slot.track.duration, 0) : 0;
      updatePositionState(true);
      emitState(false);
    });

    el.addEventListener('pause', function () {
      if (slots[active] !== slot) return;
      if (slot.ignoreEnd) return;
      state.playing = false;
      state.buffering = false;
      emitState(false);
      noteSystemPause(slot);
    });

    el.addEventListener('waiting', function () {
      if (slots[active] !== slot) return;
      if (el.paused) {
        state.buffering = false;
        return;
      }
      state.buffering = true;
      emitState(false);
    });

    el.addEventListener('stalled', function () {
      if (slots[active] !== slot) return;
      if (el.paused) {
        state.buffering = false;
        return;
      }
      state.buffering = true;
      emitState(false);
    });

    el.addEventListener('canplay', function () {
      if (slots[active] !== slot) return;
      if (state.buffering) {
        state.buffering = false;
        emitState(false);
      }
    });

    el.addEventListener('ended', function () {
      if (xfade) {
        if (slot === xfade.out) {
          /* Outgoing track reached end during fade: finish ramp early */
          finishCrossfade('ended');
          return;
        }
        if (slot === xfade.into) {
          /* Incoming track ended during fade: finish and advance immediately */
          finishCrossfade('ended');
          advance(true);
          return;
        }
      }
      if (slots[active] !== slot) return;
      if (slot.ignoreEnd) { slot.ignoreEnd = false; return; }
      advance(true);
    });

    el.addEventListener('error', function () {
      if (slots[active] !== slot) {
        slot.prefetchFor = null;
        return;
      }
      onError(slot);
    });
  }

  slots.forEach(wireSlot);

  /* ------------------------------------------------------------------ *
   * Queue Navigation & Progression
   * ------------------------------------------------------------------ */
  function nextIndex(manual) {
    var n = state.queue.length;
    if (!n) return null;
    if (state.repeat === 'one' && !manual) return state.index;
    if (state.index + 1 < n) return state.index + 1;
    if (state.repeat === 'all') return 0;
    return null;
  }

  function nextSkippingFailed(fromIndex) {
    var n = state.queue.length;
    if (!n) return null;
    for (var step = 1; step <= n; step++) {
      var j = fromIndex + step;
      if (j >= n) {
        if (state.repeat === 'all') j = j % n;
        else return null;
      }
      var t = state.queue[j];
      if (t && t.id && !failedIds.has(t.id)) return j;
    }
    return null;
  }

  function startIndex(i, opts) {
    opts = opts || {};
    if (!state.queue.length) return;
    i = clamp(Math.round(i), 0, state.queue.length - 1);
    var track = state.queue[i];
    if (!track || !track.id) return;

    if (xfade) finishCrossfade(opts.reason === 'ended' ? 'ended' : 'skip');

    var oldSlot = slots[active];
    var sameTrack = !!(oldSlot.track && oldSlot.track.id === track.id && !opts.force);

    if (sameTrack) {
      reportOccurrence(oldSlot, opts.reason || 'skip');
      oldSlot.playedReported = false;
      oldSlot.listened = 0;
      oldSlot.lastPos = 0;
      oldSlot.lastWallTime = nowMs();
      oldSlot.ignoreEnd = false;
      state.index = i;
      state.position = 0;
      state.duration = num(track.duration, 0) || num(oldSlot.el.duration, 0) || 0;
      try { oldSlot.el.currentTime = 0; } catch (e) {}
      state.error = null;
      emit('track', track);
      emitState(false);
      if (opts.autoplay !== false) playSlot(oldSlot, 0);
      return;
    }

    if (oldSlot.track) finalizeSlot(oldSlot, opts.reason || 'skip');

    /* On iOS: always stay on slot 0. Next track starts on the same element */
    if (isIOS || slots.length < 2) {
      var slotSingle = oldSlot;
      loadSlot(slotSingle, track);
      state.index = i;
      state.position = 0;
      state.duration = num(track.duration, 0);
      state.error = null;
      state.buffering = opts.autoplay !== false;
      emit('track', track);
      emitState(false);
      if (opts.autoplay !== false) playSlot(slotSingle, 0);
      return;
    }

    active = 1 - active;
    var slot = slots[active];
    stopSlot(oldSlot);

    loadSlot(slot, track);
    state.index = i;
    state.position = 0;
    state.duration = num(track.duration, 0);
    state.error = null;
    state.buffering = opts.autoplay !== false;
    emit('track', track);
    emitState(false);
    if (opts.autoplay !== false) playSlot(slot, 0);
  }

  function failStop() {
    state.error = 'No further playable tracks in queue.';
    emit('error', { track: null, message: state.error });
    state.playing = false;
    state.buffering = false;
    emitState(false);
  }

  function advance(fromEnded, opts) {
    opts = opts || {};
    if (!state.queue.length) return;

    var ni = opts.skipFailed ? nextSkippingFailed(state.index) : nextIndex(!fromEnded);
    if (ni != null && state.queue[ni]) {
      startIndex(ni, { reason: fromEnded ? 'ended' : 'skip' });
      return;
    }
    if (opts.skipFailed) {
      failStop();
      return;
    }
    if (state.repeat !== 'off') return;

    var seed = current() || state.queue[state.queue.length - 1];
    if (!seed) return;

    var targetOccurrence = seed;
    var expectedGen = ++continuationGen;
    state.buffering = true;
    emitState(false);

    autoExtend(seed, expectedGen).then(function (ok) {
      if (expectedGen !== continuationGen) return;
      if (!ok) {
        state.buffering = false;
        state.playing = false;
        emitState(false);
        return;
      }
      /* Verify the queue is still positioned on the expected seed before continuing */
      if (current() !== targetOccurrence) {
        state.buffering = false;
        emitState(false);
        return;
      }
      var j = nextIndex(!fromEnded);
      if (j != null && state.queue[j]) {
        startIndex(j, { reason: fromEnded ? 'ended' : 'skip' });
      } else {
        state.buffering = false;
        emitState(false);
      }
    }).catch(function () {
      if (expectedGen === continuationGen) {
        state.buffering = false;
        emitState(false);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Radio Autoplay
   * ------------------------------------------------------------------ */
  function autoExtend(seedTrack, expectedContinuationGen) {
    if (!seedTrack || !seedTrack.id) return Promise.resolve(false);
    var path = RADIO_PATH + encodeURIComponent(seedTrack.id);

    return requestJson(path)
      .then(function (data) {
        if (expectedContinuationGen !== continuationGen) return false;
        var list = (data && data.tracks) || [];
        var have = new Set(state.queue.map(function (t) { return t.id; }));
        var added = 0;
        for (var i = 0; i < list.length; i++) {
          var t = list[i];
          if (!t || !t.id || have.has(t.id) || failedIds.has(t.id)) continue;
          have.add(t.id);
          var trackCopy = Object.assign({}, t, { _auto: true });
          state.queue.push(trackCopy);
          added++;
        }
        if (added) emit('queue', state.queue.slice());
        return added > 0;
      })
      .catch(function () { return false; });
  }

  /* ------------------------------------------------------------------ *
   * Public Engine API
   * ------------------------------------------------------------------ */
  function clearAll() {
    queueGen++;
    continuationGen++;
    failedIds.clear();
    warmupMap.clear();
    if (xfade) finishCrossfade('ended');
    var slot = activeSlot();
    if (slot.track) finalizeSlot(slot, 'skip');
    for (var i = 0; i < slots.length; i++) stopSlot(slots[i]);
    state.queue = [];
    state.original = [];
    state.index = -1;
    state.playing = false;
    state.buffering = false;
    state.needsGesture = false;
    state.position = 0;
    state.duration = 0;
    state.error = null;
    emit('queue', []);
    emit('track', null);
    emitState(false);
  }

  function playList(tracks, startIndexAt) {
    var list = (tracks || []).filter(function (t) { return t && t.id; });
    if (!list.length) { clearAll(); return; }

    queueGen++;
    continuationGen++;
    failedIds.clear();
    warmupMap.clear();

    var start = clamp(Math.round(num(startIndexAt, 0)), 0, list.length - 1);
    state.original = list.slice();
    if (state.shuffle) {
      var cur = list[start];
      var rest = list.slice(0, start).concat(list.slice(start + 1));
      shuffleArray(rest);
      state.queue = cur ? [cur].concat(rest) : rest;
      state.index = 0;
    } else {
      state.queue = list.slice();
      state.index = start;
    }
    emit('queue', state.queue.slice());
    startIndex(state.index, { reason: 'skip', force: true });
  }

  function playOne(track) {
    if (!track || !track.id) return;
    queueGen++;
    continuationGen++;
    failedIds.clear();
    warmupMap.clear();
    state.original = [track];
    state.queue = [track];
    state.index = 0;
    emit('queue', state.queue.slice());
    startIndex(0, { reason: 'skip', force: true });
    autoExtend(track, continuationGen);
  }

  function addNext(track) {
    if (!track || !track.id) return;
    var t = Object.assign({}, track);
    delete t._auto;
    var at = state.index < 0 ? 0 : state.index + 1;
    state.queue.splice(at, 0, t);
    var cur = current();
    var oi = cur ? state.original.indexOf(cur) : -1;
    if (oi >= 0) state.original.splice(oi + 1, 0, t);
    else state.original.push(t);
    emit('queue', state.queue.slice());
    emitState(false);
  }

  function addToQueue(track) {
    if (!track || !track.id) return;
    var t = Object.assign({}, track);
    delete t._auto;
    state.queue.push(t);
    state.original.push(t);
    emit('queue', state.queue.slice());
    emitState(false);
  }

  function removeAt(i) {
    if (i < 0 || i >= state.queue.length) return;
    var wasPlaying = state.playing;
    var wasCurrent = i === state.index;
    var track = state.queue[i];

    state.queue.splice(i, 1);
    var oi = state.original.indexOf(track);
    if (oi >= 0) state.original.splice(oi, 1);
    failedIds.delete(track.id);
    queueGen++;

    if (wasCurrent) {
      continuationGen++;
      if (xfade) finishCrossfade('skip');
      var slot = activeSlot();
      if (slot.track) finalizeSlot(slot, 'skip');
      for (var s = 0; s < slots.length; s++) stopSlot(slots[s]);

      if (!state.queue.length) {
        state.index = -1;
        state.playing = false;
        state.buffering = false;
        state.position = 0;
        state.duration = 0;
        emit('queue', []);
        emit('track', null);
        emitState(false);
        return;
      }

      if (state.index >= state.queue.length) state.index = state.queue.length - 1;
      var nextTrack = state.queue[state.index];
      active = 0;
      loadSlot(slots[0], nextTrack);
      state.position = 0;
      state.duration = num(nextTrack.duration, 0);
      state.playing = false;
      state.buffering = wasPlaying;
      emit('queue', state.queue.slice());
      emit('track', nextTrack);
      emitState(false);
      if (wasPlaying) playSlot(slots[0], 0);
      return;
    }

    if (i < state.index) {
      state.index--;
    }
    emit('queue', state.queue.slice());
    emitState(false);
  }

  function move(from, to) {
    var n = state.queue.length;
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) return;
    var cur = current();
    var item = state.queue.splice(from, 1)[0];
    state.queue.splice(to, 0, item);
    state.index = cur ? state.queue.indexOf(cur) : state.index;
    emit('queue', state.queue.slice());
    emitState(false);
  }

  function jump(i) {
    if (i < 0 || i >= state.queue.length) return;
    continuationGen++;
    state.buffering = false;
    startIndex(i, { reason: 'skip' });
  }

  function play() {
    sysPause = null;
    claimAudioSession();
    if (!state.queue.length) return;
    if (state.index < 0) {
      startIndex(0, {});
      return;
    }
    var slot = activeSlot();
    var t = current();
    if (!slot.track || !t || slot.track.id !== t.id) {
      startIndex(state.index, {});
      return;
    }

    if (xfade && xfade.paused) {
      xfade.paused = false;
      xfade.lastTick = nowMs();
      try {
        var op = xfade.out.el.play();
        if (op && op.catch) op.catch(function () {});
      } catch (e) {}
    }

    playSlot(slot);
    state.playing = true;
    state.needsGesture = false;
    state.error = null;
    emitState(false);
  }

  function pause() {
    lastUserPause = nowMs();
    sysPause = null;
    continuationGen++;
    state.buffering = false;
    if (xfade && !xfade.paused) {
      xfade.paused = true;
      xfade.lastTick = nowMs();
    }
    for (var i = 0; i < slots.length; i++) {
      try { slots[i].el.pause(); } catch (e) {}
    }
    state.playing = false;
    emitState(false);
  }

  function toggle() {
    if (state.playing) pause();
    else play();
  }

  function next() {
    if (!state.queue.length) return;
    continuationGen++;
    advance(false);
  }

  function prev() {
    continuationGen++;
    var slot = activeSlot();
    if (slot.track && num(slot.el.currentTime, 0) > 3) {
      seek(0);
      if (!state.playing) play();
      return;
    }
    if (state.index > 0) {
      startIndex(state.index - 1, { reason: 'skip' });
      return;
    }
    if (state.repeat === 'all' && state.queue.length > 1) {
      startIndex(state.queue.length - 1, { reason: 'skip' });
      return;
    }
    seek(0);
    if (!state.playing) play();
  }

  /* Swipe-right on the mini player: always the previous song (no restart-first rule). */
  function prevTrack() {
    continuationGen++;
    if (state.index > 0) { startIndex(state.index - 1, { reason: 'skip' }); return; }
    if (state.repeat === 'all' && state.queue.length > 1) { startIndex(state.queue.length - 1, { reason: 'skip' }); return; }
    seek(0);
    if (!state.playing) play();
  }

  function seek(sec) {
    var slot = activeSlot();
    if (!slot.track) return;
    var d = state.duration || num(slot.track.duration, 0) || 0;
    var t = num(Number(sec), 0);
    if (d > 0) t = Math.min(t, Math.max(0, d - 0.05));
    t = Math.max(0, t);
    slot.isSeeking = true;
    try { slot.el.currentTime = t; } catch (e) {}
    slot.lastPos = t;
    slot.lastWallTime = nowMs();
    state.position = t;
    updatePositionState(true);
    emitState(false);
  }

  function setVolume(v) {
    var nv = clamp(num(Number(v), state.volume), 0, 1);
    state.volume = nv;
    if (xfade) {
      applyFadeVolumes(fadeProgress());
    } else {
      for (var i = 0; i < slots.length; i++) {
        setElVol(slots[i], nv);
      }
    }
    emitState(false);
  }

  function setShuffle(v) {
    var want = !!v;
    if (want === state.shuffle) return;
    state.shuffle = want;
    if (want) {
      state.original = state.queue.slice();
      var curIdx = state.index;
      if (curIdx >= 0 && curIdx < state.queue.length) {
        var cur = state.queue[curIdx];
        var rest = state.queue.slice(0, curIdx).concat(state.queue.slice(curIdx + 1));
        shuffleArray(rest);
        state.queue = [cur].concat(rest);
        state.index = 0;
      } else {
        var all = state.queue.slice();
        shuffleArray(all);
        state.queue = all;
        state.index = -1;
      }
    } else {
      var curItem = current();
      var extras = state.queue.filter(function (t) {
        return state.original.indexOf(t) < 0;
      });
      var merged = state.original.concat(extras);
      state.queue = merged;
      state.index = curItem ? Math.max(0, merged.indexOf(curItem)) : (merged.length ? 0 : -1);
    }
    emit('queue', state.queue.slice());
    emitState(false);
  }

  function setRepeat(mode) {
    var m = REPEAT_MODES.indexOf(mode) >= 0 ? mode : 'off';
    if (m === state.repeat) return;
    state.repeat = m;
    emitState(false);
  }

  function cycleRepeat() {
    var i = REPEAT_MODES.indexOf(state.repeat);
    setRepeat(REPEAT_MODES[(i + 1) % REPEAT_MODES.length]);
  }

  function setCrossfade(sec) {
    state.crossfade = clamp(num(Number(sec), 0), 0, 12);
    if (iosXfadeOn()) { ensureActx(); resumeActx(); }
    emitState(false);
  }

  function stop() {
    lastUserPause = nowMs();
    sysPause = null;
    queueGen++;
    continuationGen++;
    failedIds.clear();
    warmupMap.clear();
    if (xfade) finishCrossfade('ended');
    var slot = activeSlot();
    if (slot.track) finalizeSlot(slot, 'skip');
    for (var i = 0; i < slots.length; i++) stopSlot(slots[i]);
    state.playing = false;
    state.buffering = false;
    state.needsGesture = false;
    state.position = 0;
    state.duration = 0;
    emitState(false);
  }

  /* ------------------------------------------------------------------ *
   * Session Persistence (localStorage, Scoped by User ID)
   * ------------------------------------------------------------------ */
  function saveSession() {
    try {
      var uid = getCurrentUserId();
      var q = state.queue;
      var len = q.length;
      var key = getSessionKey(uid);
      if (!len) {
        localStorage.removeItem(key);
        return;
      }
      var start = 0;
      if (len > SESSION_WINDOW) {
        start = clamp(state.index - Math.floor(SESSION_WINDOW / 2), 0, len - SESSION_WINDOW);
      }
      var win = q.slice(start, start + SESSION_WINDOW).map(function (t) {
        var copy = Object.assign({}, t);
        if (t._auto) copy._auto = true;
        return copy;
      });

      var posMap = new Map();
      for (var qi = 0; qi < len; qi++) {
        if (!posMap.has(q[qi])) posMap.set(q[qi], qi);
      }
      var origPos = [];
      for (var oi = 0; oi < state.original.length; oi++) {
        var idx = posMap.get(state.original[oi]);
        if (idx !== undefined) origPos.push(idx);
      }
      var seen = Object.create(null);
      var ordered = [];
      for (var k = 0; k < origPos.length; k++) {
        var p = origPos[k];
        if (seen[p]) continue;
        seen[p] = true;
        ordered.push(p);
      }
      for (var x = 0; x < len; x++) {
        if (!seen[x]) ordered.push(x);
      }
      var orderWin = [];
      for (var m = 0; m < ordered.length; m++) {
        var a = ordered[m];
        if (a >= start && a < start + win.length) orderWin.push(a - start);
      }
      if (orderWin.length !== win.length) {
        orderWin = [];
        for (var n = 0; n < win.length; n++) orderWin.push(n);
      }

      var payload = {
        v: 2,
        uid: uid,
        queue: win,
        originalOrder: orderWin,
        index: clamp(state.index - start, 0, Math.max(0, win.length - 1)),
        position: state.position,
        shuffle: state.shuffle,
        repeat: state.repeat,
        volume: state.volume,
        crossfade: state.crossfade,
        at: Date.now()
      };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (e) {}
  }

  function restore() {
    var uid = getCurrentUserId();
    var key = getSessionKey(uid);
    var snap = null;
    try {
      var raw = localStorage.getItem(key);
      if (!raw && !uid) raw = localStorage.getItem(SESSION_FALLBACK);
      snap = raw ? JSON.parse(raw) : null;
    } catch (e) {
      snap = null;
    }
    if (!snap || !Array.isArray(snap.queue) || !snap.queue.length) return false;
    /* Do not restore session from another user */
    if (snap.uid && uid && snap.uid !== uid) return false;

    var q = snap.queue.filter(function (t) { return t && typeof t === 'object' && t.id; });
    if (!q.length) return false;

    queueGen++;
    continuationGen++;
    failedIds.clear();
    warmupMap.clear();

    if (xfade) finishCrossfade('ended');
    for (var s = 0; s < slots.length; s++) stopSlot(slots[s]);
    active = 0;

    state.queue = q;
    state.shuffle = !!snap.shuffle;
    state.repeat = REPEAT_MODES.indexOf(snap.repeat) >= 0 ? snap.repeat : 'off';
    state.volume = clamp(num(snap.volume, 0.8), 0, 1);
    state.crossfade = clamp(num(snap.crossfade, 0), 0, 12);
    state.index = clamp(Math.round(num(snap.index, 0)), 0, q.length - 1);
    state.playing = false;
    state.buffering = false;
    state.needsGesture = false;
    state.error = null;

    var order = Array.isArray(snap.originalOrder) ? snap.originalOrder : null;
    var orig = [];
    var used = Object.create(null);
    if (order && order.length) {
      for (var i = 0; i < order.length; i++) {
        var oi = order[i];
        if (typeof oi === 'number' && oi >= 0 && oi < q.length && !used[oi]) {
          used[oi] = true;
          orig.push(q[oi]);
        }
      }
    }
    for (var j = 0; j < q.length; j++) {
      if (!used[j]) orig.push(q[j]);
    }
    state.original = orig;

    var track = q[state.index];
    var pos = Math.max(0, num(snap.position, 0));
    var slot = slots[0];
    var gen = loadSlot(slot, track);
    setElVol(slot, state.volume);
    state.duration = num(track.duration, 0);
    state.position = pos;
    slot.lastPos = pos;
    slot.lastWallTime = nowMs();

    if (pos > 0.25) {
      var onMeta = function () {
        slot.el.removeEventListener('loadedmetadata', onMeta);
        if (slot.loadGen !== gen || slot.track !== track) return;
        try {
          slot.el.currentTime = pos;
          slot.lastPos = pos;
          slot.lastWallTime = nowMs();
        } catch (e) {}
      };
      slot.el.addEventListener('loadedmetadata', onMeta);
    }

    emit('track', track);
    emit('queue', state.queue.slice());
    emitState(false);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Authentication Lifecycle Synchronization
   * ------------------------------------------------------------------ */
  function onAccountChange(newUid) {
    if (newUid === activeUserId) return;
    saveSession();
    stop();
    activeUserId = newUid;
    restore();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', function (e) {
      if (e.key === 'um.token' || e.key === 'um.user') {
        var currentId = getCurrentUserId();
        if (currentId !== activeUserId) onAccountChange(currentId);
      }
    });
  }

  function hookCoreAuth() {
    if (UM.core && typeof UM.core.on === 'function') {
      UM.core.on('auth', function (evt) {
        var newId = (evt && evt.user && (evt.user.id || evt.user.name)) ? String(evt.user.id || evt.user.name) : '';
        onAccountChange(newId);
      });
      return true;
    }
    return false;
  }

  if (!hookCoreAuth()) {
    var checkCoreTimer = setInterval(function () {
      if (hookCoreAuth()) clearInterval(checkCoreTimer);
    }, 100);
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle & Global Handlers
   * ------------------------------------------------------------------ */
  on('track', function (t) { updateMetadata(t); });
  on('state', function () { updatePlaybackState(); });

  attachElements();
  initMediaSession();

  /* Never pause on visibilitychange / pagehide; save session on pagehide only */
  window.addEventListener('pagehide', saveSession);
  window.addEventListener('beforeunload', saveSession);

  /* Periodic session backup (no timers that pause playback) */
  setInterval(saveSession, SESSION_INTERVAL);

  /* ------------------------------------------------------------------ *
   * Module Export
   * ------------------------------------------------------------------ */
  UM.player = {
    playList: playList,
    playOne: playOne,
    addNext: addNext,
    addToQueue: addToQueue,
    removeAt: removeAt,
    move: move,
    jump: jump,
    toggle: toggle,
    play: play,
    pause: pause,
    next: next,
    prev: prev,
    prevTrack: prevTrack,
    seek: seek,
    stop: stop,

    setVolume: setVolume,
    setShuffle: setShuffle,
    setRepeat: setRepeat,
    cycleRepeat: cycleRepeat,
    setCrossfade: setCrossfade,

    current: current,
    getState: snapshot,
    songKey: songKey,

    saveSession: saveSession,
    restore: restore,

    on: on,
    off: off,

    state: state
  };
})();
