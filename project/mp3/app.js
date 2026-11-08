/* UTSHOW Music (web) — app.js (v1.2)
 * Shell only: desktop three-panel layout + mobile phone layout (header, mini-player,
 * bottom navigation, full-screen Now Playing modal sheet), left library rail,
 * right now-playing panel, queue drawer, search pill suggestions, player bar wiring,
 * router dispatching to UM.views, keyboard shortcuts, and service-worker lifecycle.
 * Strictly uses classes defined in static/app.css and APIs from UM.core, UM.ui, UM.player.
 */
(function () {
  'use strict';

  var UM = window.UM || (window.UM = {});
  var core = UM.core;
  var ui = UM.ui;
  var player = UM.player;
  var h = ui.h;
  var icon = ui.icon;

  /* ------------------------------------------------------------------ *
   * Shell State
   * ------------------------------------------------------------------ */
  var initialNowOpen = false;
  try {
    var storedNow = localStorage.getItem('um.nowOpen');
    if (storedNow !== null) {
      initialNowOpen = (storedNow === 'true');
    } else {
      initialNowOpen = window.innerWidth >= 1200;
    }
  } catch (e) {
    initialNowOpen = window.innerWidth >= 1200;
  }

  var state = {
    libFilter: 'all',          // 'all' | 'playlists' | 'albums' | 'artists'
    libSort: 'recent',         // 'recent' | 'alpha'
    libCollapsed: false,
    libOpen: false,            // mobile overlay state
    nowOpen: initialNowOpen,   // desktop now-playing panel state
    hasAutoOpenedNow: false,
    queueOpen: false,
    nowSheetOpen: false,       // full-screen Now Playing sheet (mobile / overlay)
    sheetTab: 'lyrics',        // 'next' | 'lyrics'
    lyricsData: null,
    lyricsTrackId: null,
    activeLyricIdx: -1,
    activePreviewLyricIdx: -1,
    routeGen: 0,
    currentPath: ''
  };

  /* Settings save debounce helper */
  var settingsSaveTimer = null;
  function scheduleSaveSettings() {
    if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(function () {
      settingsSaveTimer = null;
      core.saveLibrary().catch(function () {});
    }, 800);
  }

  /* ------------------------------------------------------------------ *
   * DOM Elements Construction
   * ------------------------------------------------------------------ */
  var rootApp = h('div', {
    className: 'um-app' + (state.nowOpen && window.innerWidth >= 1200 ? ' um-app--now-open' : '')
  });

  /* Top Bar */
  var topbar = h('header', { className: 'um-topbar' });

  var topbarLeft = h('div', { className: 'um-topbar-left' });
  var menuBtn = h('button', {
    className: 'um-icon-btn',
    title: 'Your Library',
    style: 'min-width:44px;min-height:44px;',
    html: icon('menu'),
    onClick: function () { toggleMobileLib(); }
  });
  var logo = h('a', { className: 'um-logo', href: '#/home' },
    h('div', { className: 'um-logo-mark', html: icon('note') })
  );
  topbarLeft.appendChild(menuBtn);
  topbarLeft.appendChild(logo);

  var topbarCenter = h('div', { className: 'um-topbar-center' });
  var homeBtn = h('button', {
    className: 'um-home-btn',
    title: 'Home',
    html: icon('home'),
    onClick: function () { ui.nav('#/home'); }
  });

  var searchPill = h('div', { className: 'um-search-pill' });
  var searchPillIcon = h('span', { className: 'um-search-pill-icon', html: icon('search') });
  var searchInput = h('input', {
    className: 'um-search-pill-input',
    placeholder: 'What do you want to play?',
    type: 'search',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false'
  });
  var searchSuggest = h('div', { className: 'um-suggest um-hidden' });
  searchPill.appendChild(searchPillIcon);
  searchPill.appendChild(searchInput);
  searchPill.appendChild(searchSuggest);

  topbarCenter.appendChild(homeBtn);
  topbarCenter.appendChild(searchPill);

  var topbarActions = h('div', { className: 'um-topbar-actions' });
  var settingsBtn = h('button', {
    className: 'um-icon-btn',
    title: 'Settings',
    style: 'min-width:44px;min-height:44px;',
    html: icon('gear'),
    onClick: function () { ui.nav('#/settings'); }
  });
  var avatarBtn = h('button', {
    className: 'um-avatar',
    title: 'Your Library',
    style: 'min-width:44px;min-height:44px;',
    text: 'U',
    onClick: function () { ui.nav('#/library'); }
  });
  topbarActions.appendChild(settingsBtn);
  topbarActions.appendChild(avatarBtn);

  topbar.appendChild(topbarLeft);
  topbar.appendChild(topbarCenter);
  topbar.appendChild(topbarActions);

  /* Main Grid */
  var mainGrid = h('main', { className: 'um-main' });

  /* Left Panel — Your Library */
  var leftPanel = h('aside', { className: 'um-panel um-panel--library' });

  var libHead = h('div', { className: 'um-lib-head' });
  var libTitle = h('div', { className: 'um-lib-title' },
    h('span', { html: icon('lib') }),
    document.createTextNode('Your Library')
  );
  var libCreateBtn = h('button', {
    className: 'um-lib-create',
    style: 'min-height:44px;',
    onClick: function () {
      ui.prompt({
        title: 'New Playlist',
        placeholder: 'Playlist name',
        okText: 'Create'
      }).then(function (name) {
        if (!name) return;
        var pl = core.createPlaylist(name);
        if (pl) ui.nav('#/userpl/' + encodeURIComponent(pl.id));
      });
    }
  },
    h('span', { html: icon('plus') }),
    document.createTextNode(' Create')
  );
  var libCollapseBtn = h('button', {
    className: 'um-icon-btn',
    title: 'Collapse library',
    style: 'min-width:44px;min-height:44px;',
    html: icon('collapse'),
    onClick: function () {
      state.libCollapsed = !state.libCollapsed;
      rootApp.classList.toggle('um-app--lib-collapsed', state.libCollapsed);
    }
  });
  libHead.appendChild(libTitle);
  libHead.appendChild(libCreateBtn);
  libHead.appendChild(libCollapseBtn);

  var libFilters = h('div', { className: 'um-lib-filters' });
  var filterPills = ['Playlists', 'Albums', 'Artists'].map(function (label) {
    var key = label.toLowerCase();
    var p = h('button', {
      className: 'um-pill',
      style: 'min-height:36px;',
      text: label,
      onClick: function () {
        state.libFilter = (state.libFilter === key) ? 'all' : key;
        updateLibPillStates();
        renderLibList();
      }
    });
    libFilters.appendChild(p);
    return { key: key, el: p };
  });

  function updateLibPillStates() {
    for (var i = 0; i < filterPills.length; i++) {
      var item = filterPills[i];
      item.el.classList.toggle('um-pill--active', state.libFilter === item.key);
    }
  }

  var libTools = h('div', { className: 'um-lib-tools' });
  var sortLabel = document.createTextNode(' Recents');
  var sortBtn = h('button', {
    className: 'um-lib-sort',
    style: 'min-height:36px;',
    onClick: function () {
      state.libSort = (state.libSort === 'recent') ? 'alpha' : 'recent';
      sortLabel.textContent = state.libSort === 'recent' ? ' Recents' : ' Alphabetical';
      renderLibList();
    }
  },
    h('span', { html: icon('sort') }),
    sortLabel
  );
  libTools.appendChild(sortBtn);

  var libList = h('div', { className: 'um-lib-list' });
  var libResizer = h('div', { className: 'um-resizer' });

  leftPanel.appendChild(libHead);
  leftPanel.appendChild(libFilters);
  leftPanel.appendChild(libTools);
  leftPanel.appendChild(libList);
  leftPanel.appendChild(libResizer);

  /* Centre Panel */
  var centerPanel = h('section', { className: 'um-panel um-panel--center' });
  var centerTint = h('div', { className: 'um-view-tint' });
  var centerView = h('div', { className: 'um-view' });
  centerPanel.appendChild(centerTint);
  centerPanel.appendChild(centerView);

  /* Right Panel — Now playing (desktop) */
  var nowPanel = h('aside', { className: 'um-panel um-panel--now' });
  var npHead = h('div', { className: 'um-np-head' });
  var npSource = h('div', { className: 'um-np-source', text: 'Now playing' });
  var npCloseBtn = h('button', {
    className: 'um-icon-btn',
    title: 'Close panel',
    style: 'min-width:44px;min-height:44px;',
    html: icon('close'),
    onClick: function () { toggleNowPanel(false); }
  });
  npHead.appendChild(npSource);
  npHead.appendChild(npCloseBtn);
  var npBody = h('div', { className: 'um-np-body' });
  nowPanel.appendChild(npHead);
  nowPanel.appendChild(npBody);

  mainGrid.appendChild(leftPanel);
  mainGrid.appendChild(centerPanel);
  mainGrid.appendChild(nowPanel);

  /* Bottom Player Bar */
  var swipeSwallowClick = false;
  var playerBar = h('footer', {
    className: 'um-playerbar',
    onClick: function (e) {
      if (swipeSwallowClick) { swipeSwallowClick = false; e.stopPropagation(); return; }
      if (ui.isPhone()) {
        if (e.target.closest('.um-pb-controls') || e.target.closest('.um-like')) return;
        openNowSheet('lyrics');
      }
    }
  });

  /* Mini progress line on top of player bar for phones */
  var miniProgress = h('div', { className: 'um-mini-progress' });
  var miniProgressFill = h('div', { className: 'um-mini-progress-fill' });
  miniProgress.appendChild(miniProgressFill);
  playerBar.appendChild(miniProgress);

  /* Left: Art, Title, Artist, Like */
  var pbLeft = h('div', { className: 'um-pb-left' });
  var pbArt = h('div', {
    className: 'um-pb-art',
    onClick: function (e) {
      e.stopPropagation();
      onArtClick();
    }
  });
  var pbMeta = h('div', { className: 'um-pb-meta' });
  var pbTitle = h('button', {
    className: 'um-pb-title',
    text: 'Nothing playing',
    onClick: function (e) {
      if (ui.isPhone()) {
        e.stopPropagation();
        openNowSheet('lyrics');
        return;
      }
      var cur = player.current();
      if (cur && cur.albumId) ui.nav('#/album/' + encodeURIComponent(cur.albumId));
      else onArtClick();
    }
  });
  var pbArtist = h('button', {
    className: 'um-pb-artist',
    text: '',
    onClick: function (e) {
      if (ui.isPhone()) {
        e.stopPropagation();
        openNowSheet('lyrics');
        return;
      }
      var cur = player.current();
      if (cur && cur.artistId) ui.nav('#/artist/' + encodeURIComponent(cur.artistId));
    }
  });
  pbMeta.appendChild(pbTitle);
  pbMeta.appendChild(pbArtist);

  var pbLikeBtn = h('button', {
    className: 'um-like',
    title: 'Like',
    style: 'min-width:44px;min-height:44px;',
    html: icon('heart'),
    onClick: function (e) {
      e.stopPropagation();
      var cur = player.current();
      if (cur) core.toggleLike(cur);
    }
  });
  pbLeft.appendChild(pbArt);
  pbLeft.appendChild(pbMeta);
  pbLeft.appendChild(pbLikeBtn);

  /* Phone mini player: swipe the song left = next, right = previous (Spotify-style).
   * Horizontal intent locks after 10px; vertical drags are left alone. */
  (function attachMiniSwipe() {
    var sx = 0, sy = 0, st = 0, dx = 0, lock = '', w = 1;
    function setX(x, anim) {
      pbLeft.style.transition = anim ? 'transform .22s ease, opacity .22s ease' : 'none';
      pbLeft.style.transform = x ? 'translateX(' + x + 'px)' : '';
      pbLeft.style.opacity = x ? String(Math.max(0.2, 1 - Math.abs(x) / w)) : '';
    }
    pbLeft.addEventListener('touchstart', function (e) {
      if (!ui.isPhone() || e.touches.length !== 1 || !player.current()) return;
      var t = e.touches[0];
      sx = t.clientX; sy = t.clientY; st = Date.now(); dx = 0; lock = '';
      w = pbLeft.offsetWidth || 300;
    }, { passive: true });
    pbLeft.addEventListener('touchmove', function (e) {
      if (!st) return;
      var t = e.touches[0], mx = t.clientX - sx, my = t.clientY - sy;
      if (!lock) {
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      }
      if (lock !== 'x') return;
      if (e.cancelable) e.preventDefault();
      dx = mx;
      setX(dx, false);
    }, { passive: false });
    function end() {
      if (!st) return;
      var dt = Math.max(1, Date.now() - st), go = lock === 'x' && (Math.abs(dx) > w * 0.3 || (Math.abs(dx) > 40 && Math.abs(dx) / dt > 0.5));
      st = 0;
      if (lock !== 'x') return;
      swipeSwallowClick = true;
      setTimeout(function () { swipeSwallowClick = false; }, 400);
      if (!go) { setX(0, true); return; }
      var dir = dx < 0 ? -1 : 1;
      setX(dir * w, true);
      setTimeout(function () {
        if (dir < 0) player.next(); else player.prevTrack();
        setX(-dir * w * 0.6, false);
        void pbLeft.offsetWidth;
        setX(0, true);
      }, 200);
    }
    pbLeft.addEventListener('touchend', end);
    pbLeft.addEventListener('touchcancel', function () { if (st) { st = 0; setX(0, true); } });
  })();

  /* Center: Transport + Seek */
  var pbCenter = h('div', { className: 'um-pb-center' });
  var pbControls = h('div', { className: 'um-pb-controls' });

  var shuffleBtn = h('button', {
    className: 'um-pb-btn',
    title: 'Shuffle',
    style: 'min-width:44px;min-height:44px;',
    html: icon('shuffle'),
    onClick: function (e) {
      e.stopPropagation();
      var nextState = !player.state.shuffle;
      player.setShuffle(nextState);
      core.lib.settings.shuffle = nextState;
      scheduleSaveSettings();
    }
  });
  var prevBtn = h('button', {
    className: 'um-pb-btn',
    title: 'Previous',
    style: 'min-width:44px;min-height:44px;',
    html: icon('prev'),
    onClick: function (e) {
      e.stopPropagation();
      player.prev();
    }
  });
  var playBtn = h('button', {
    className: 'um-pb-play',
    title: 'Play / Pause',
    style: 'min-width:44px;min-height:44px;',
    html: icon('play'),
    onClick: function (e) {
      e.stopPropagation();
      player.toggle();
    }
  });
  var nextBtn = h('button', {
    className: 'um-pb-btn',
    title: 'Next',
    style: 'min-width:44px;min-height:44px;',
    html: icon('next'),
    onClick: function (e) {
      e.stopPropagation();
      player.next();
    }
  });
  var repeatBtn = h('button', {
    className: 'um-pb-btn',
    title: 'Repeat',
    style: 'min-width:44px;min-height:44px;',
    html: icon('repeat'),
    onClick: function (e) {
      e.stopPropagation();
      player.cycleRepeat();
      core.lib.settings.repeat = player.state.repeat;
      scheduleSaveSettings();
    }
  });

  pbControls.appendChild(shuffleBtn);
  pbControls.appendChild(prevBtn);
  pbControls.appendChild(playBtn);
  pbControls.appendChild(nextBtn);
  pbControls.appendChild(repeatBtn);

  var pbSeek = h('div', { className: 'um-pb-seek' });
  var timeCur = h('span', { className: 'um-pb-time', text: '0:00' });
  var seekRange = h('input', {
    className: 'um-range',
    type: 'range',
    min: 0,
    max: 1000,
    value: 0
  });
  var timeTotal = h('span', { className: 'um-pb-time', text: '0:00' });
  var userSeeking = false;

  seekRange.addEventListener('input', function () {
    userSeeking = true;
    var frac = Number(seekRange.value) / 1000;
    var dur = player.state.duration || 0;
    timeCur.textContent = ui.fmtTime(frac * dur);
    seekRange.style.setProperty('--um-fill', (frac * 100) + '%');
    syncSheetSeek(frac, dur);
  });
  seekRange.addEventListener('change', function () {
    var frac = Number(seekRange.value) / 1000;
    var dur = player.state.duration || 0;
    player.seek(frac * dur);
    userSeeking = false;
  });

  pbSeek.appendChild(timeCur);
  pbSeek.appendChild(seekRange);
  pbSeek.appendChild(timeTotal);
  pbCenter.appendChild(pbControls);
  pbCenter.appendChild(pbSeek);

  /* Right: Lyrics, Queue, Now Playing view toggle, Volume */
  var pbRight = h('div', { className: 'um-pb-right' });
  var lyricsBtn = h('button', {
    className: 'um-icon-btn',
    title: 'Lyrics',
    style: 'min-width:44px;min-height:44px;',
    html: icon('lyrics'),
    onClick: function (e) {
      e.stopPropagation();
      openNowSheet('lyrics');
    }
  });
  var queueBtn = h('button', {
    className: 'um-icon-btn',
    title: 'Queue',
    style: 'min-width:44px;min-height:44px;',
    html: icon('queue'),
    onClick: function (e) {
      e.stopPropagation();
      toggleQueue();
    }
  });
  var nowViewBtn = h('button', {
    className: 'um-icon-btn' + (state.nowOpen ? ' um-icon-btn--on' : ''),
    title: 'Now playing view',
    style: 'min-width:44px;min-height:44px;',
    html: icon('note'),
    onClick: function (e) {
      e.stopPropagation();
      toggleNowPanel();
    }
  });
  var pbVol = h('div', { className: 'um-pb-vol' });
  var muteBtn = h('button', {
    className: 'um-icon-btn',
    title: 'Mute',
    style: 'min-width:36px;min-height:36px;',
    html: icon('volHigh'),
    onClick: function () {
      if (player.state.volume > 0.001) {
        player._lastVol = player.state.volume;
        player.setVolume(0);
        core.lib.settings.volume = 0;
      } else {
        var rest = player._lastVol || 0.8;
        player.setVolume(rest);
        core.lib.settings.volume = rest;
      }
      scheduleSaveSettings();
    }
  });
  var volRange = h('input', {
    className: 'um-range um-range--sm',
    type: 'range',
    min: 0,
    max: 100,
    value: 80
  });
  volRange.addEventListener('input', function () {
    var v = Number(volRange.value) / 100;
    player.setVolume(v);
    core.lib.settings.volume = v;
    scheduleSaveSettings();
    volRange.style.setProperty('--um-fill', volRange.value + '%');
  });
  pbVol.appendChild(muteBtn);
  pbVol.appendChild(volRange);

  pbRight.appendChild(lyricsBtn);
  pbRight.appendChild(queueBtn);
  pbRight.appendChild(nowViewBtn);
  pbRight.appendChild(pbVol);

  playerBar.appendChild(pbLeft);
  playerBar.appendChild(pbCenter);
  playerBar.appendChild(pbRight);

  /* Mobile Bottom Navigation Bar */
  var bnav = h('nav', { className: 'um-bnav' });
  var bnavItems = [
    { hash: '#/home', icon: 'home', label: 'Home' },
    { hash: '#/search', icon: 'search', label: 'Search' },
    { hash: '#/library', icon: 'lib', label: 'Library' }
  ].map(function (item) {
    var btn = h('button', {
      className: 'um-bnav-item',
      style: 'min-width:44px;min-height:44px;',
      onClick: function () { ui.nav(item.hash); }
    },
      h('span', { html: icon(item.icon) }),
      h('span', { text: item.label })
    );
    bnav.appendChild(btn);
    return { hash: item.hash, el: btn };
  });

  function updateBnavActive(hash) {
    for (var i = 0; i < bnavItems.length; i++) {
      var it = bnavItems[i];
      var isAct = (hash === it.hash) || (it.hash === '#/home' && (hash === '' || hash === '#/'));
      it.el.classList.toggle('um-bnav-item--active', isAct);
    }
  }

  /* Queue Drawer */
  var queueDrawer = h('div', { className: 'um-queue' });
  var queueHead = h('div', { className: 'um-queue-head' },
    h('h3', { text: 'Play Queue' }),
    h('button', {
      className: 'um-icon-btn',
      title: 'Close',
      style: 'min-width:44px;min-height:44px;',
      html: icon('close'),
      onClick: function () { toggleQueue(false); }
    })
  );
  var queueList = h('div', { className: 'um-queue-list' });
  queueDrawer.appendChild(queueHead);
  queueDrawer.appendChild(queueList);

  /* Full-Screen Now Playing Overlay / Mobile Sheet */
  var nowSheet = h('div', { className: 'um-overlay um-hidden' });
  var sheetPanel = h('div', { className: 'um-overlay-panel' });

  var sheetGripArea = h('div', {
    style: 'min-height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;',
    onClick: function () { closeNowSheet(); }
  });
  var sheetGrip = h('div', { className: 'um-sheet-grip' });
  sheetGripArea.appendChild(sheetGrip);

  var sheetClose = h('button', {
    className: 'um-overlay-close',
    title: 'Close',
    style: 'min-width:44px;min-height:44px;',
    html: icon('close'),
    onClick: function () { closeNowSheet(); }
  });

  var npFull = h('div', { className: 'um-npfull' });
  var npFullArt = h('div', { className: 'um-npfull-art' });
  var npFullSide = h('div', { className: 'um-npfull-side' });

  var npFullHeaderRow = h('div', {
    className: 'um-np-row',
    style: 'width:100%;align-items:center;flex:0 0 auto;'
  });
  var npFullTextStack = h('div', { className: 'um-np-text', style: 'flex:1 1 auto;min-width:0;' });
  var npFullTitle = h('div', { className: 'um-npfull-title', text: 'Nothing playing' });
  var npFullArtist = h('button', {
    className: 'um-npfull-artist um-npfull-artist--link',
    text: '',
    onClick: function (e) {
      e.stopPropagation();
      var cur = player.current();
      if (!cur) return;
      var dest = cur.artistId
        ? '#/artist/' + encodeURIComponent(cur.artistId)
        : '#/search?q=' + encodeURIComponent(String(cur.artists || '').split(/,|&| feat\.? /i)[0].trim()) + '&type=artists';
      /* Close the sheet but keep its history entry: it becomes "back". */
      if (state.nowSheetOpen) {
        state.nowSheetOpen = false;
        nowSheet.classList.add('um-hidden');
        releaseLayer('sheet', true);
      }
      ui.nav(dest);
    }
  });
  npFullTextStack.appendChild(npFullTitle);
  npFullTextStack.appendChild(npFullArtist);

  var fullLikeBtn = h('button', {
    className: 'um-like',
    title: 'Like',
    style: 'min-width:44px;min-height:44px;',
    html: icon('heart'),
    onClick: function (e) {
      e.stopPropagation();
      var cur = player.current();
      if (cur) core.toggleLike(cur);
    }
  });
  npFullHeaderRow.appendChild(npFullTextStack);
  npFullHeaderRow.appendChild(fullLikeBtn);

  /* Sheet Seek Control with elapsed / total time */
  var fullSeek = h('div', {
    className: 'um-pb-seek um-npfull-seek',
    style: 'width:100%;max-width:none;padding:6px 0;flex:0 0 auto;'
  });
  var fullTimeCur = h('span', { className: 'um-pb-time', text: '0:00' });
  var fullSeekRange = h('input', {
    className: 'um-range',
    type: 'range',
    min: 0,
    max: 1000,
    value: 0
  });
  var fullTimeTotal = h('span', { className: 'um-pb-time', text: '0:00' });
  var fullUserSeeking = false;

  fullSeekRange.addEventListener('input', function () {
    fullUserSeeking = true;
    var frac = Number(fullSeekRange.value) / 1000;
    var dur = player.state.duration || 0;
    fullTimeCur.textContent = ui.fmtTime(frac * dur);
    fullSeekRange.style.setProperty('--um-fill', (frac * 100) + '%');
    timeCur.textContent = ui.fmtTime(frac * dur);
    seekRange.value = fullSeekRange.value;
    seekRange.style.setProperty('--um-fill', (frac * 100) + '%');
  });
  fullSeekRange.addEventListener('change', function () {
    var frac = Number(fullSeekRange.value) / 1000;
    var dur = player.state.duration || 0;
    player.seek(frac * dur);
    fullUserSeeking = false;
  });

  fullSeek.appendChild(fullTimeCur);
  fullSeek.appendChild(fullSeekRange);
  fullSeek.appendChild(fullTimeTotal);

  function syncSheetSeek(frac, dur) {
    if (!fullUserSeeking) {
      fullTimeCur.textContent = ui.fmtTime(frac * dur);
      fullTimeTotal.textContent = ui.fmtTime(dur);
      var pct = Math.min(100, Math.max(0, frac * 100));
      fullSeekRange.value = Math.round(frac * 1000);
      fullSeekRange.style.setProperty('--um-fill', pct + '%');
    }
  }

  /* Sheet Controls — Main + Secondary */
  var npFullControls = h('div', {
    className: 'um-npfull-controls',
    style: 'flex-wrap:wrap;justify-content:center;gap:12px;'
  });

  var fullShuffleBtn = h('button', {
    className: 'um-pb-btn',
    title: 'Shuffle',
    style: 'min-width:44px;min-height:44px;',
    html: icon('shuffle'),
    onClick: function () {
      player.setShuffle(!player.state.shuffle);
      core.lib.settings.shuffle = player.state.shuffle;
      scheduleSaveSettings();
    }
  });
  var fullPrevBtn = h('button', {
    className: 'um-pb-btn',
    title: 'Previous',
    style: 'min-width:44px;min-height:44px;',
    html: icon('prev'),
    onClick: function () { player.prev(); }
  });
  var fullPlayBtn = h('button', {
    className: 'um-pb-play',
    title: 'Play / Pause',
    style: 'min-width:56px;min-height:56px;',
    html: icon('play'),
    onClick: function () { player.toggle(); }
  });
  var fullNextBtn = h('button', {
    className: 'um-pb-btn',
    title: 'Next',
    style: 'min-width:44px;min-height:44px;',
    html: icon('next'),
    onClick: function () { player.next(); }
  });
  var fullRepeatBtn = h('button', {
    className: 'um-pb-btn',
    title: 'Repeat',
    style: 'min-width:44px;min-height:44px;',
    html: icon('repeat'),
    onClick: function () {
      player.cycleRepeat();
      core.lib.settings.repeat = player.state.repeat;
      scheduleSaveSettings();
    }
  });

  npFullControls.appendChild(fullShuffleBtn);
  npFullControls.appendChild(fullPrevBtn);
  npFullControls.appendChild(fullPlayBtn);
  npFullControls.appendChild(fullNextBtn);
  npFullControls.appendChild(fullRepeatBtn);

  /* Segmented Up Next / Lyrics tabs on mobile sheet */
  var npTabs = h('div', { className: 'um-np-tabs', style: 'flex:0 0 auto;' });
  var tabLyrics = h('button', {
    className: 'um-np-tab um-np-tab--active',
    style: 'min-height:44px;',
    text: 'Lyrics',
    onClick: function () { setSheetTab('lyrics'); }
  });
  var tabNext = h('button', {
    className: 'um-np-tab',
    style: 'min-height:44px;',
    text: 'Up next',
    onClick: function () { setSheetTab('next'); }
  });
  npTabs.appendChild(tabLyrics);
  npTabs.appendChild(tabNext);

  var paneLyrics = h('div', { className: 'um-np-pane' });
  var lyricsScroller = h('div', { className: 'um-lyrics' });
  paneLyrics.appendChild(lyricsScroller);

  var paneNext = h('div', { className: 'um-np-pane um-np-pane--hidden' });
  var sheetNextList = h('div', { className: 'um-queue-list' });
  paneNext.appendChild(sheetNextList);

  /* Volume row (PC/tablet; phones use the hardware buttons). */
  var fullVol = h('div', { className: 'um-npfull-vol' });
  var fullMuteBtn = h('button', {
    className: 'um-icon-btn',
    title: 'Mute',
    html: icon('volHigh'),
    onClick: function () { muteBtn.click(); }
  });
  var fullVolRange = h('input', { className: 'um-range um-range--sm', type: 'range', min: 0, max: 100, value: 80 });
  fullVolRange.addEventListener('input', function () {
    volRange.value = fullVolRange.value;
    volRange.dispatchEvent(new Event('input'));
    fullVolRange.style.setProperty('--um-fill', fullVolRange.value + '%');
  });
  var fullVolPct = h('span', { className: 'um-npfull-vol-pct', text: '80%' });
  fullVol.appendChild(fullMuteBtn);
  fullVol.appendChild(fullVolRange);
  fullVol.appendChild(fullVolPct);

  /* Left "stage": art + title + seek + transport + volume, one centred column.
     Right side: lyrics / up next. Phones stack the two. */
  var npFullBg = h('div', { className: 'um-npfull-bg' });
  var npFullStage = h('div', { className: 'um-npfull-stage' });
  npFullStage.appendChild(npFullArt);
  npFullStage.appendChild(npFullHeaderRow);
  npFullStage.appendChild(fullSeek);
  npFullStage.appendChild(npFullControls);
  npFullStage.appendChild(fullVol);

  npFullSide.appendChild(npTabs);
  npFullSide.appendChild(paneLyrics);
  npFullSide.appendChild(paneNext);

  npFull.appendChild(npFullStage);
  npFull.appendChild(npFullSide);

  sheetPanel.appendChild(npFullBg);
  sheetPanel.appendChild(sheetGripArea);
  sheetPanel.appendChild(sheetClose);
  sheetPanel.appendChild(npFull);
  nowSheet.appendChild(sheetPanel);

  /* Mount to document: replace existing #app or append */
  rootApp.appendChild(topbar);
  rootApp.appendChild(mainGrid);
  rootApp.appendChild(playerBar);
  rootApp.appendChild(bnav);
  rootApp.appendChild(queueDrawer);
  rootApp.appendChild(nowSheet);

  var targetEl = document.getElementById('app');
  if (targetEl) {
    targetEl.replaceWith(rootApp);
    rootApp.id = 'app';
  } else {
    document.body.appendChild(rootApp);
  }

  /* ------------------------------------------------------------------ *
   * Resizable Left Rail Interaction
   * ------------------------------------------------------------------ */
  (function () {
    var dragging = false;
    libResizer.addEventListener('mousedown', function (e) {
      e.preventDefault();
      dragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var w = Math.min(420, Math.max(220, e.clientX - 8));
      rootApp.style.setProperty('--um-lib-w', w + 'px');
    });
    window.addEventListener('mouseup', function () {
      if (dragging) {
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  })();

  /* ------------------------------------------------------------------ *
   * Responsive Panel Synchronization
   * ------------------------------------------------------------------ */
  function syncPanelLayout() {
    var w = window.innerWidth;
    if (w < 1200) {
      rootApp.classList.remove('um-app--now-open');
    } else if (state.nowOpen) {
      rootApp.classList.add('um-app--now-open');
    }
  }
  window.addEventListener('resize', syncPanelLayout);

  /* ------------------------------------------------------------------ *
   * Back button: every full-screen layer (Now Playing sheet, queue, phone
   * library drawer, menus, dialogs) pushes a history entry, so the browser /
   * Android back button closes the layer instead of leaving the app.
   * ------------------------------------------------------------------ */
  var layerStack = [];
  var suppressPops = 0;
  function pushLayer(name, closeFn) {
    for (var i = 0; i < layerStack.length; i++) if (layerStack[i].name === name) return;
    layerStack.push({ name: name, close: closeFn });
    try { history.pushState({ umLayer: name }, ''); } catch (e) {}
  }
  function releaseLayer(name, noBack) {
    // Called when the UI closed a layer itself (X button, swipe, Esc).
    // noBack: the close is followed by a navigation, so leave the entry in
    // place (it then simply acts as the previous page).
    for (var i = layerStack.length - 1; i >= 0; i--) {
      if (layerStack[i].name === name) {
        layerStack.splice(i, 1);
        if (!noBack && history.state && history.state.umLayer) { suppressPops++; history.back(); }
        return;
      }
    }
  }
  window.addEventListener('popstate', function () {
    if (suppressPops > 0) { suppressPops--; return; }
    var top = layerStack.pop();
    if (top) { try { top.close(true); } catch (e) {} }
  });
  UM.layers = { push: pushLayer, release: releaseLayer };

  /* ------------------------------------------------------------------ *
   * Visibility & Toggle Controllers
   * ------------------------------------------------------------------ */
  function toggleMobileLib(show, fromPop) {
    if (show == null) show = !state.libOpen;
    if (show === state.libOpen) return;
    state.libOpen = show;
    rootApp.classList.toggle('um-app--lib-open', show);
    if (show) pushLayer('lib', function () { toggleMobileLib(false, true); });
    else if (fromPop === 'nav') releaseLayer('lib', true);
    else if (!fromPop) releaseLayer('lib');
  }

  function toggleNowPanel(show) {
    if (window.innerWidth < 1200) {
      openNowSheet('lyrics');
      return;
    }
    if (show == null) show = !state.nowOpen;
    state.nowOpen = show;
    try {
      localStorage.setItem('um.nowOpen', show ? 'true' : 'false');
    } catch (e) {}
    rootApp.classList.toggle('um-app--now-open', show);
    nowViewBtn.classList.toggle('um-icon-btn--on', show);
    if (show) renderNowPanel();
  }

  function toggleQueue(show, fromPop) {
    if (show == null) show = !state.queueOpen;
    if (show === state.queueOpen) return;
    state.queueOpen = show;
    queueDrawer.classList.toggle('um-queue--open', show);
    if (show) { renderQueueDrawer(); pushLayer('queue', function () { toggleQueue(false, true); }); }
    else if (!fromPop) releaseLayer('queue');
  }

  function onArtClick() {
    if (window.innerWidth < 1200) {
      openNowSheet('lyrics');
    } else {
      toggleNowPanel(true);
    }
  }

  function openNowSheet(tab) {
    if (!state.nowSheetOpen) pushLayer('sheet', function () { closeNowSheet(true); });
    state.nowSheetOpen = true;
    nowSheet.classList.remove('um-hidden');
    setSheetTab(tab || 'lyrics');
    syncNowSheetTrack(player.current());
    state.activeLyricIdx = -1;
    loadLyrics(player.current());
    setTimeout(function () {
      var act = lyricsScroller.querySelector('.um-lyrics-line--active');
      if (act) scrollLyricLineIntoView(act, true);
    }, 80);
  }

  function closeNowSheet(fromPop) {
    if (!state.nowSheetOpen) return;
    state.nowSheetOpen = false;
    nowSheet.classList.add('um-hidden');
    if (!fromPop) releaseLayer('sheet');
  }

  function setSheetTab(tab) {
    state.sheetTab = tab;
    tabLyrics.classList.toggle('um-np-tab--active', tab === 'lyrics');
    tabNext.classList.toggle('um-np-tab--active', tab === 'next');
    paneLyrics.classList.toggle('um-np-pane--hidden', tab !== 'lyrics');
    paneNext.classList.toggle('um-np-pane--hidden', tab !== 'next');
    if (tab === 'next') renderSheetNextList();
    if (tab === 'lyrics') {
      setTimeout(function () {
        var act = lyricsScroller.querySelector('.um-lyrics-line--active');
        if (act) scrollLyricLineIntoView(act, true);
      }, 60);
    }
  }

  /* Swipe-down on phone sheet grip to dismiss */
  (function () {
    var startY = 0;
    sheetGripArea.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches[0]) startY = e.touches[0].clientY;
    }, { passive: true });
    sheetGripArea.addEventListener('touchend', function (e) {
      if (e.changedTouches && e.changedTouches[0]) {
        var diff = e.changedTouches[0].clientY - startY;
        if (diff > 45) closeNowSheet();
      }
    });
  })();

  /* ------------------------------------------------------------------ *
   * Top Search Pill & Suggestions Dropdown
   * ------------------------------------------------------------------ */
  var suggestTimer = null;
  var suggestActiveIdx = -1;
  var currentSuggestions = [];

  function closeSuggestions() {
    searchSuggest.classList.add('um-hidden');
    searchSuggest.innerHTML = '';
    suggestActiveIdx = -1;
    currentSuggestions = [];
    if (suggestTimer) { clearTimeout(suggestTimer); suggestTimer = null; }
  }

  searchInput.addEventListener('input', function () {
    var q = searchInput.value.trim();
    if (!q) { closeSuggestions(); return; }
    if (suggestTimer) clearTimeout(suggestTimer);
    suggestTimer = setTimeout(function () {
      UM.req('/api/suggest?q=' + encodeURIComponent(q))
        .then(function (data) {
          if (!searchInput.value.trim()) { closeSuggestions(); return; }
          var items = (data && data.items) || [];
          currentSuggestions = items;
          suggestActiveIdx = -1;
          searchSuggest.innerHTML = '';
          if (!items.length) {
            searchSuggest.classList.add('um-hidden');
            return;
          }
          searchSuggest.classList.remove('um-hidden');
          for (var i = 0; i < items.length; i++) {
            (function (s, idx) {
              var btn = h('button', {
                className: 'um-suggest-item',
                style: 'min-height:44px;',
                onClick: function () {
                  searchInput.value = s;
                  closeSuggestions();
                  ui.nav('#/search?q=' + encodeURIComponent(s));
                }
              },
                h('span', { html: icon('search') }),
                document.createTextNode(' ' + s)
              );
              btn.dataset.idx = String(idx);
              searchSuggest.appendChild(btn);
            })(items[i], i);
          }
        })
        .catch(function () {});
    }, 150);
  });

  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') {
      if (currentSuggestions.length > 0) {
        e.preventDefault();
        suggestActiveIdx = Math.min(currentSuggestions.length - 1, suggestActiveIdx + 1);
        highlightSuggestion();
      }
    } else if (e.key === 'ArrowUp') {
      if (currentSuggestions.length > 0) {
        e.preventDefault();
        suggestActiveIdx = Math.max(0, suggestActiveIdx - 1);
        highlightSuggestion();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestActiveIdx >= 0 && currentSuggestions[suggestActiveIdx]) {
        var pick = currentSuggestions[suggestActiveIdx];
        searchInput.value = pick;
        closeSuggestions();
        ui.nav('#/search?q=' + encodeURIComponent(pick));
      } else {
        var query = searchInput.value.trim();
        closeSuggestions();
        if (query) ui.nav('#/search?q=' + encodeURIComponent(query));
      }
    } else if (e.key === 'Escape') {
      closeSuggestions();
    }
  });

  function highlightSuggestion() {
    var nodes = searchSuggest.querySelectorAll('.um-suggest-item');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('um-suggest-item--active', i === suggestActiveIdx);
    }
  }

  document.addEventListener('click', function (e) {
    if (!searchPill.contains(e.target)) closeSuggestions();
  });

  /* ------------------------------------------------------------------ *
   * Lyrics Loader & Scroller
   * ------------------------------------------------------------------ */
  function loadLyrics(track) {
    if (!track || !track.id) {
      state.lyricsData = null;
      state.lyricsTrackId = null;
      state.activeLyricIdx = -1;
      state.activePreviewLyricIdx = -1;
      renderLyricsLines(null);
      renderNowPanelLyrics(null);
      return;
    }
    if (state.lyricsTrackId === track.id && state.lyricsData) {
      renderLyricsLines(state.lyricsData);
      renderNowPanelLyrics(state.lyricsData);
      return;
    }

    /* Reset active state immediately to avoid showing previous track's lyrics */
    state.lyricsData = null;
    state.lyricsTrackId = track.id;
    state.activeLyricIdx = -1;
    state.activePreviewLyricIdx = -1;

    lyricsScroller.innerHTML = '';
    lyricsScroller.appendChild(h('div', { className: 'um-lyrics-empty', text: 'Loading lyrics…' }));

    var previewContainer = npBody.querySelector('.um-lyrics-plain');
    if (previewContainer) {
      previewContainer.innerHTML = '';
      previewContainer.appendChild(h('div', { className: 'um-np-lyrics-empty', text: 'Loading lyrics…' }));
    }

    var trackId = track.id;
    var path = '/api/lyrics?id=' + encodeURIComponent(track.id) +
      '&title=' + encodeURIComponent(track.title || '') +
      '&artist=' + encodeURIComponent(track.artists || '') +
      '&album=' + encodeURIComponent(track.album || '') +
      '&duration=' + encodeURIComponent(track.duration || 0);

    UM.req(path)
      .then(function (data) {
        var cur = player.current();
        if (!cur || cur.id !== trackId) return;
        state.lyricsData = data;
        state.lyricsTrackId = trackId;
        renderLyricsLines(data);
        renderNowPanelLyrics(data);
      })
      .catch(function () {
        var cur = player.current();
        if (!cur || cur.id !== trackId) return;
        state.lyricsData = null;
        state.lyricsTrackId = trackId;
        renderLyricsLines(null);
        renderNowPanelLyrics(null);
      });
  }

  function renderLyricsLines(data) {
    lyricsScroller.innerHTML = '';
    if (!data || (!data.synced && !data.plain)) {
      lyricsScroller.appendChild(h('div', { className: 'um-lyrics-empty', text: 'No lyrics found.' }));
      return;
    }
    if (data.synced && data.synced.length) {
      for (var i = 0; i < data.synced.length; i++) {
        (function (line, idx) {
          var btn = h('button', {
            className: 'um-lyrics-line',
            text: line.line || '♪',
            onClick: function () { player.seek(line.t); }
          });
          btn.dataset.time = String(line.t);
          btn.dataset.idx = String(idx);
          lyricsScroller.appendChild(btn);
        })(data.synced[i], i);
      }
      state.activeLyricIdx = -1;
      syncLyricsPosition(player.state.position);
    } else if (data.plain) {
      lyricsScroller.appendChild(h('div', { className: 'um-lyrics-plain', text: data.plain }));
    }
  }

  function syncLyricsPosition(pos) {
    var cur = player.current();
    if (!cur || cur.id !== state.lyricsTrackId) return;
    if (!state.lyricsData || !state.lyricsData.synced || !state.lyricsData.synced.length) return;

    var synced = state.lyricsData.synced;
    var activeIdx = -1;
    for (var i = 0; i < synced.length; i++) {
      if (pos >= synced[i].t) activeIdx = i;
      else break;
    }

    if (activeIdx !== state.activePreviewLyricIdx) {
      state.activePreviewLyricIdx = activeIdx;
      updateNowPanelLyricsPreview(activeIdx);
    }

    if (activeIdx === state.activeLyricIdx) return;
    state.activeLyricIdx = activeIdx;

    if (!state.nowSheetOpen) return;

    var lines = lyricsScroller.querySelectorAll('.um-lyrics-line');
    if (!lines.length) return;

    for (var j = 0; j < lines.length; j++) {
      lines[j].classList.toggle('um-lyrics-line--active', j === activeIdx);
    }

    if (activeIdx >= 0 && lines[activeIdx]) {
      scrollLyricLineIntoView(lines[activeIdx]);
    }
  }

  /* Auto-scroll: centre the active line inside whichever ancestor actually
     scrolls (the lyrics box on desktop, the sheet on some phone layouts).
     A manual scroll by the user pauses auto-scroll for 4 s. */
  var lyricsUserScrollUntil = 0;
  var lyricsProgrammaticScroll = false;
  function markLyricsUserScroll() {
    if (lyricsProgrammaticScroll) return;
    lyricsUserScrollUntil = Date.now() + 4000;
  }
  ['wheel', 'touchmove'].forEach(function (ev) {
    lyricsScroller.addEventListener(ev, markLyricsUserScroll, { passive: true });
    npFull.addEventListener(ev, markLyricsUserScroll, { passive: true });
  });

  function scrollableAncestor(el) {
    var node = el.parentElement;
    while (node && node !== document.body) {
      var oy = getComputedStyle(node).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 2) return node;
      node = node.parentElement;
    }
    return null;
  }

  function scrollLyricLineIntoView(line, instant) {
    if (!instant && Date.now() < lyricsUserScrollUntil) return;
    var box = scrollableAncestor(line);
    if (!box) return;
    var boxRect = box.getBoundingClientRect();
    var lineRect = line.getBoundingClientRect();
    var target = box.scrollTop + (lineRect.top - boxRect.top) - (box.clientHeight / 2) + (lineRect.height / 2);
    lyricsProgrammaticScroll = true;
    box.scrollTo({ top: Math.max(0, target), behavior: instant ? 'auto' : 'smooth' });
    setTimeout(function () { lyricsProgrammaticScroll = false; }, 600);
  }

  function updateNowPanelLyricsPreview(curIdx) {
    var container = npBody.querySelector('.um-lyrics-plain');
    if (!container) return;
    var data = state.lyricsData;
    if (!data || !data.synced || !data.synced.length) return;

    container.innerHTML = '';
    var synced = data.synced;
    var start = Math.max(0, (curIdx >= 0 ? curIdx : 0) - 1);
    var slice = synced.slice(start, start + 3);
    for (var j = 0; j < slice.length; j++) {
      var isNow = (start + j === curIdx);
      container.appendChild(h('div', {
        className: 'um-np-lyric-line' + (isNow ? ' um-np-lyric-line--now' : ''),
        text: slice[j].line || '♪'
      }));
    }
  }

  /* ------------------------------------------------------------------ *
   * Right Panel (Desktop Now Playing)
   * ------------------------------------------------------------------ */
  function renderNowPanel() {
    npBody.innerHTML = '';
    var cur = player.current();
    if (!cur) {
      npBody.appendChild(h('div', { className: 'um-empty', style: 'padding:40px 10px;' },
        h('div', { className: 'um-empty-icon', html: icon('note') }),
        h('div', { className: 'um-empty-title', text: 'No track playing' }),
        h('div', { className: 'um-empty-text', text: 'Choose a song, mix or radio station to start playback.' })
      ));
      return;
    }

    var artCard = h('div', {
      className: 'um-np-art',
      onClick: function () { openNowSheet('lyrics'); }
    },
      ui.img(cur.art || cur.thumb, '')
    );

    var textRow = h('div', { className: 'um-np-row' });
    var textStack = h('div', { className: 'um-np-text' },
      h('button', {
        className: 'um-np-title',
        text: cur.title,
        onClick: function () {
          if (cur.albumId) ui.nav('#/album/' + encodeURIComponent(cur.albumId));
        }
      }),
      h('button', {
        className: 'um-np-artist',
        text: cur.artists,
        onClick: function () {
          if (cur.artistId) ui.nav('#/artist/' + encodeURIComponent(cur.artistId));
        }
      })
    );
    var likeBtn = h('button', {
      className: 'um-like' + (core.isLiked(cur.id) ? ' um-like--on' : ''),
      title: 'Like',
      style: 'min-width:44px;min-height:44px;',
      html: core.isLiked(cur.id) ? icon('heartFill') : icon('heart'),
      onClick: function () { core.toggleLike(cur); }
    });
    textRow.appendChild(textStack);
    textRow.appendChild(likeBtn);

    /* Lyrics Preview Card */
    var lyricsCard = h('div', {
      className: 'um-np-lyrics',
      onClick: function () { openNowSheet('lyrics'); }
    },
      h('div', { className: 'um-np-card-head', text: 'Lyrics Preview' }),
      h('div', { className: 'um-lyrics-plain' })
    );

    /* About the artist card */
    var aboutCard = h('div', {
      className: 'um-np-about',
      onClick: function () {
        if (cur.artistId) ui.nav('#/artist/' + encodeURIComponent(cur.artistId));
      }
    },
      h('div', { className: 'um-np-about-banner' },
        ui.img(cur.art || cur.thumb, ''),
        h('div', { className: 'um-np-about-name', text: cur.artists })
      ),
      h('div', { className: 'um-np-about-foot', text: 'View artist profile & top releases' })
    );

    /* Next in queue card */
    var nextCard = h('div', { className: 'um-np-card um-np-next' });
    buildNextQueueCard(nextCard);

    npBody.appendChild(artCard);
    npBody.appendChild(textRow);
    npBody.appendChild(lyricsCard);
    npBody.appendChild(aboutCard);
    npBody.appendChild(nextCard);

    loadLyrics(cur);
  }

  function renderNowPanelLyrics(data) {
    var container = npBody.querySelector('.um-lyrics-plain');
    if (!container) return;
    container.innerHTML = '';
    if (!data || (!data.synced && !data.plain)) {
      container.appendChild(h('div', { className: 'um-np-lyrics-empty', text: 'No lyrics available.' }));
      return;
    }
    if (data.synced && data.synced.length) {
      var pos = player.state.position;
      var curIdx = 0;
      for (var i = 0; i < data.synced.length; i++) {
        if (pos >= data.synced[i].t) curIdx = i;
        else break;
      }
      state.activePreviewLyricIdx = curIdx;
      var slice = data.synced.slice(Math.max(0, curIdx - 1), curIdx + 2);
      for (var j = 0; j < slice.length; j++) {
        var isNow = (slice[j] === data.synced[curIdx]);
        container.appendChild(h('div', {
          className: 'um-np-lyric-line' + (isNow ? ' um-np-lyric-line--now' : ''),
          text: slice[j].line || '♪'
        }));
      }
    } else if (data.plain) {
      var lines = data.plain.split('\n').filter(function (l) { return l.trim().length > 0; }).slice(0, 3);
      for (var k = 0; k < lines.length; k++) {
        container.appendChild(h('div', {
          className: 'um-np-lyric-line' + (k === 0 ? ' um-np-lyric-line--now' : ''),
          text: lines[k]
        }));
      }
    }
  }

  function buildNextQueueCard(container) {
    container.innerHTML = '';
    var head = h('div', { className: 'um-np-card-head' },
      h('span', { text: 'Next in queue' }),
      h('button', {
        className: 'um-btn um-btn--ghost',
        style: 'min-height:36px;padding:0 12px;font-size:11px;',
        text: 'Open queue',
        onClick: function (e) {
          e.stopPropagation();
          toggleQueue(true);
        }
      })
    );
    container.appendChild(head);

    var q = player.state.queue;
    var idx = player.state.index;
    var nextTracks = q.slice(idx + 1, idx + 4);
    if (!nextTracks.length) {
      container.appendChild(h('div', { className: 'um-card-sub', text: 'Queue ends soon (radio will continue).' }));
      return;
    }
    for (var i = 0; i < nextTracks.length; i++) {
      (function (t) {
        var row = h('div', {
          className: 'um-np-next-row',
          onClick: function () {
            var j = player.state.queue.indexOf(t);
            if (j >= 0) player.jump(j);
          }
        },
          ui.img(t.thumb || t.art, ''),
          h('div', { className: 'um-np-next-text' },
            h('div', { className: 'um-card-title', text: t.title }),
            h('div', { className: 'um-card-sub', text: t.artists })
          )
        );
        container.appendChild(row);
      })(nextTracks[i]);
    }
  }

  /* ------------------------------------------------------------------ *
   * Queue Drawer & Mobile Next List
   * ------------------------------------------------------------------ */
  function renderQueueDrawer() {
    queueList.innerHTML = '';
    var q = player.state.queue;
    var curIdx = player.state.index;
    if (!q.length) {
      queueList.appendChild(h('div', { className: 'um-empty', style: 'padding:40px 10px;' },
        h('div', { className: 'um-empty-title', text: 'Queue is empty' })
      ));
      return;
    }
    for (var i = 0; i < q.length; i++) {
      (function (t, index) {
        var isCur = (index === curIdx);
        var row = h('div', {
          className: 'um-queue-row' + (isCur ? ' um-queue-row--active' : ''),
          onClick: function () { player.jump(index); }
        },
          h('div', { className: 'um-queue-row-art' }, ui.img(t.thumb || t.art, '')),
          h('div', { className: 'um-queue-row-text' },
            h('div', { className: 'um-card-title', text: t.title }),
            h('div', { className: 'um-card-sub', text: t.artists })
          ),
          h('button', {
            className: 'um-icon-btn',
            title: 'Remove',
            style: 'min-width:44px;min-height:44px;',
            html: icon('close'),
            onClick: function (e) {
              e.stopPropagation();
              player.removeAt(index);
              renderQueueDrawer();
            }
          })
        );
        queueList.appendChild(row);
      })(q[i], i);
    }
  }

  function renderSheetNextList() {
    sheetNextList.innerHTML = '';
    var q = player.state.queue;
    var curIdx = player.state.index;
    var nextTracks = q.slice(curIdx + 1);
    if (!nextTracks.length) {
      sheetNextList.appendChild(h('div', { className: 'um-empty', style: 'padding:32px 10px;' },
        h('div', { className: 'um-empty-title', text: 'End of queue' }),
        h('div', { className: 'um-empty-text', text: 'Radio will pick up automatically.' })
      ));
      return;
    }
    for (var i = 0; i < nextTracks.length; i++) {
      (function (t, offset) {
        var realIdx = curIdx + 1 + offset;
        var row = h('div', {
          className: 'um-queue-row',
          onClick: function () { player.jump(realIdx); }
        },
          h('div', { className: 'um-queue-row-art' }, ui.img(t.thumb || t.art, '')),
          h('div', { className: 'um-queue-row-text' },
            h('div', { className: 'um-card-title', text: t.title }),
            h('div', { className: 'um-card-sub', text: t.artists })
          ),
          h('button', {
            className: 'um-icon-btn',
            title: 'Remove',
            style: 'min-width:44px;min-height:44px;',
            html: icon('close'),
            onClick: function (e) {
              e.stopPropagation();
              player.removeAt(realIdx);
              renderSheetNextList();
            }
          })
        );
        sheetNextList.appendChild(row);
      })(nextTracks[i], i);
    }
  }

  /* ------------------------------------------------------------------ *
   * Left Library List Builder
   * ------------------------------------------------------------------ */
  function renderLibList() {
    libList.innerHTML = '';

    /* Liked Songs Entry */
    if (state.libFilter === 'all' || state.libFilter === 'playlists') {
      var likedCount = (core.lib.liked && core.lib.liked.length) || 0;
      var likedRow = h('button', {
        className: 'um-lib-row',
        style: 'min-height:56px;',
        onClick: function () {
          toggleMobileLib(false, 'nav');
          ui.nav('#/liked');
        }
      },
        h('div', { className: 'um-lib-row-art um-lib-row-art--liked', html: icon('heartFill') }),
        h('div', { className: 'um-lib-row-text' },
          h('div', { className: 'um-lib-row-title', text: 'Liked Songs' }),
          h('div', { className: 'um-lib-row-sub', text: 'Playlist • ' + likedCount + ' songs' })
        )
      );
      libList.appendChild(likedRow);
    }

    /* Made for you mixes */
    if (state.libFilter === 'all' || state.libFilter === 'playlists') {
      var mixesRow = h('button', {
        className: 'um-lib-row',
        style: 'min-height:56px;',
        onClick: function () {
          toggleMobileLib(false, 'nav');
          ui.nav('#/home');
        }
      },
        h('div', {
          className: 'um-lib-row-art',
          style: 'background: linear-gradient(135deg, #1F6FE0, #0D1A30); display:grid; place-items:center; color:#fff;',
          html: icon('radio')
        }),
        h('div', { className: 'um-lib-row-text' },
          h('div', { className: 'um-lib-row-title', text: 'Made for you' }),
          h('div', { className: 'um-lib-row-sub', text: 'Mixes & Stations' })
        )
      );
      libList.appendChild(mixesRow);
    }

    /* User Playlists */
    if (state.libFilter === 'all' || state.libFilter === 'playlists') {
      var pls = (core.lib.playlists || []).slice();
      if (state.libSort === 'alpha') {
        pls.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
      }
      for (var p = 0; p < pls.length; p++) {
        (function (pl) {
          var count = (pl.tracks && pl.tracks.length) || 0;
          var art = (pl.tracks && pl.tracks[0] && (pl.tracks[0].thumb || pl.tracks[0].art)) || null;
          var row = h('button', {
            className: 'um-lib-row',
            style: 'min-height:56px;',
            onClick: function () {
              toggleMobileLib(false, 'nav');
              ui.nav('#/userpl/' + encodeURIComponent(pl.id));
            },
            onContextmenu: function (e) {
              e.preventDefault();
              ui.menu(e, [
                {
                  text: 'Play',
                  icon: icon('play'),
                  action: function () { if (pl.tracks && pl.tracks.length) player.playList(pl.tracks, 0); }
                },
                {
                  text: 'Rename',
                  action: function () {
                    ui.prompt({ title: 'Rename Playlist', value: pl.name, okText: 'Save' }).then(function (nn) {
                      if (nn) core.renamePlaylist(pl.id, nn);
                    });
                  }
                },
                {
                  text: 'Delete',
                  icon: icon('trash'),
                  danger: true,
                  action: function () {
                    ui.confirm({ title: 'Delete Playlist?', text: 'Are you sure you want to delete "' + pl.name + '"?', danger: true })
                      .then(function (ok) {
                        if (ok) {
                          core.deletePlaylist(pl.id);
                          if (window.location.hash.indexOf(pl.id) >= 0) ui.nav('#/home');
                        }
                      });
                  }
                }
              ]);
            }
          },
            h('div', { className: 'um-lib-row-art' },
              art ? ui.img(art, '') : h('div', { className: 'um-img-fallback', html: icon('note') })
            ),
            h('div', { className: 'um-lib-row-text' },
              h('div', { className: 'um-lib-row-title', text: pl.name }),
              h('div', { className: 'um-lib-row-sub', text: 'Playlist • ' + count + ' songs' })
            )
          );
          libList.appendChild(row);
        })(pls[p]);
      }
    }

    /* Saved Albums from history */
    if (state.libFilter === 'all' || state.libFilter === 'albums') {
      var albumMap = {};
      (core.lib.history || []).forEach(function (t) {
        if (t.album && t.albumId && !albumMap[t.albumId]) {
          albumMap[t.albumId] = { id: t.albumId, title: t.album, artists: t.artists, art: t.art || t.thumb };
        }
      });
      var albums = Object.values(albumMap);
      if (state.libSort === 'alpha') {
        albums.sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); });
      }
      albums.forEach(function (alb) {
        var row = h('button', {
          className: 'um-lib-row',
          style: 'min-height:56px;',
          onClick: function () {
            toggleMobileLib(false, 'nav');
            ui.nav('#/album/' + encodeURIComponent(alb.id));
          }
        },
          h('div', { className: 'um-lib-row-art' }, ui.img(alb.art, '')),
          h('div', { className: 'um-lib-row-text' },
            h('div', { className: 'um-lib-row-title', text: alb.title }),
            h('div', { className: 'um-lib-row-sub', text: 'Album • ' + alb.artists })
          )
        );
        libList.appendChild(row);
      });
    }

    /* Saved Artists from history */
    if (state.libFilter === 'all' || state.libFilter === 'artists') {
      var artistMap = {};
      (core.lib.history || []).forEach(function (t) {
        if (t.artists && t.artistId && !artistMap[t.artistId]) {
          artistMap[t.artistId] = { id: t.artistId, name: t.artists, art: t.art || t.thumb };
        }
      });
      var artists = Object.values(artistMap);
      if (state.libSort === 'alpha') {
        artists.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      }
      artists.forEach(function (art) {
        var row = h('button', {
          className: 'um-lib-row',
          style: 'min-height:56px;',
          onClick: function () {
            toggleMobileLib(false, 'nav');
            ui.nav('#/artist/' + encodeURIComponent(art.id));
          }
        },
          h('div', { className: 'um-lib-row-art', style: 'border-radius:50%;' }, ui.img(art.art, '')),
          h('div', { className: 'um-lib-row-text' },
            h('div', { className: 'um-lib-row-title', text: art.name }),
            h('div', { className: 'um-lib-row-sub', text: 'Artist' })
          )
        );
        libList.appendChild(row);
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Player State Synchronization
   * ------------------------------------------------------------------ */
  function syncTrackUI(t) {
    if (!t) {
      pbTitle.textContent = 'Nothing playing';
      pbArtist.textContent = '';
      pbArt.innerHTML = '';
      npFullTitle.textContent = 'Nothing playing';
      npFullArtist.textContent = '';
      npFullArt.innerHTML = '';
      state.lyricsData = null;
      state.lyricsTrackId = null;
      state.activeLyricIdx = -1;
      state.activePreviewLyricIdx = -1;

      timeCur.textContent = '0:00';
      timeTotal.textContent = '0:00';
      seekRange.value = 0;
      seekRange.style.setProperty('--um-fill', '0%');
      fullTimeCur.textContent = '0:00';
      fullTimeTotal.textContent = '0:00';
      fullSeekRange.value = 0;
      fullSeekRange.style.setProperty('--um-fill', '0%');
      miniProgressFill.style.width = '0%';

      renderLyricsLines(null);
      renderNowPanel();
      updateLikeButtons(null);
      updatePlayingTrackRow();
      return;
    }

    pbTitle.textContent = t.title || 'Untitled';
    pbArtist.textContent = t.artists || '';
    pbArt.innerHTML = '';
    pbArt.appendChild(ui.img(t.thumb || t.art, ''));

    syncNowSheetTrack(t);
    updateLikeButtons(t.id);
    renderNowPanel();
    updatePlayingTrackRow();
  }

  function syncNowSheetTrack(t) {
    if (!t) return;
    npFullTitle.textContent = t.title || 'Untitled';
    npFullArtist.textContent = t.artists || '';
    npFullArt.innerHTML = '';
    npFullArt.appendChild(ui.img(t.art || t.thumb, ''));
    var bgUrl = t.art || t.thumb || '';
    npFullBg.style.backgroundImage = bgUrl ? 'url("' + String(bgUrl).replace(/"/g, '%22') + '")' : 'none';
  }

  function updateLikeButtons(currentTrackId) {
    var cur = player.current();
    var liked = cur ? core.isLiked(cur.id) : false;
    pbLikeBtn.classList.toggle('um-like--on', liked);
    pbLikeBtn.innerHTML = liked ? icon('heartFill') : icon('heart');

    fullLikeBtn.classList.toggle('um-like--on', liked);
    fullLikeBtn.innerHTML = liked ? icon('heartFill') : icon('heart');

    var npLike = npBody.querySelector('.um-like');
    if (npLike) {
      npLike.classList.toggle('um-like--on', liked);
      npLike.innerHTML = liked ? icon('heartFill') : icon('heart');
    }

    var allTracks = document.querySelectorAll('.um-track');
    for (var i = 0; i < allTracks.length; i++) {
      var r = allTracks[i];
      var tid = r.dataset.trackId;
      var btn = r.querySelector('.um-like');
      if (btn && tid) {
        var isLk = core.isLiked(tid);
        btn.classList.toggle('um-like--on', isLk);
        btn.innerHTML = isLk ? icon('heartFill') : icon('heart');
      }
    }
  }

  function updatePlayingTrackRow() {
    var cur = player.current();
    var curId = cur ? cur.id : null;
    var rows = document.querySelectorAll('.um-track');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var isCur = (r.dataset.trackId === curId);
      r.classList.toggle('um-track--current', isCur);
      var idxCell = r.querySelector('.um-track-idx');
      if (idxCell) {
        if (isCur) {
          idxCell.innerHTML = '';
          idxCell.appendChild(h('div', { className: 'um-eq' },
            h('div', { className: 'um-eq-bar' }),
            h('div', { className: 'um-eq-bar' }),
            h('div', { className: 'um-eq-bar' })
          ));
        } else if (idxCell.querySelector('.um-eq')) {
          idxCell.textContent = r.dataset.displayIdx || '';
        }
      }
    }
  }

  player.on('track', function (t) {
    syncTrackUI(t);

    /* Ask the server to look up the next two songs now, so Next and
       auto-advance don't wait on YouTube (slow on the small VM). */
    try {
      var st = player.getState();
      var ids = [];
      for (var k = 1; k <= 2; k++) {
        var nt = st.queue[st.index + k];
        if (nt && nt.id) ids.push(nt.id);
      }
      if (ids.length) {
        core.prefetch(ids);
      }
    } catch (e) {}

    /* Auto-open desktop right panel on wide screens on initial play */
    if (t && window.innerWidth >= 1200 && !state.hasAutoOpenedNow) {
      try {
        if (localStorage.getItem('um.nowOpen') !== 'false') {
          state.hasAutoOpenedNow = true;
          toggleNowPanel(true);
        }
      } catch (e) {}
    }

    if (state.queueOpen) renderQueueDrawer();
    if (state.nowSheetOpen && state.sheetTab === 'next') renderSheetNextList();
  });

  player.on('state', function (snap) {
    /* Play/pause state and spinner */
    if (snap.buffering) {
      playBtn.innerHTML = '<div class="um-spinner"></div>';
      fullPlayBtn.innerHTML = '<div class="um-spinner"></div>';
      playBtn.classList.remove('um-pb-play--needs-gesture');
      fullPlayBtn.classList.remove('um-pb-play--needs-gesture');
    } else {
      playBtn.innerHTML = snap.playing ? icon('pause') : icon('play');
      fullPlayBtn.innerHTML = snap.playing ? icon('pause') : icon('play');
      playBtn.classList.toggle('um-pb-play--needs-gesture', !!snap.needsGesture);
      fullPlayBtn.classList.toggle('um-pb-play--needs-gesture', !!snap.needsGesture);
    }

    var eqTracks = document.querySelectorAll('.um-track--current');
    for (var eqi = 0; eqi < eqTracks.length; eqi++) eqTracks[eqi].classList.toggle('um-paused', !snap.playing);

    shuffleBtn.classList.toggle('um-pb-btn--on', !!snap.shuffle);
    fullShuffleBtn.classList.toggle('um-pb-btn--on', !!snap.shuffle);

    repeatBtn.classList.toggle('um-pb-btn--on', snap.repeat !== 'off');
    fullRepeatBtn.classList.toggle('um-pb-btn--on', snap.repeat !== 'off');
    repeatBtn.innerHTML = snap.repeat === 'one' ? icon('repeatOne') : icon('repeat');
    fullRepeatBtn.innerHTML = snap.repeat === 'one' ? icon('repeatOne') : icon('repeat');

    /* Times and Seek Ranges */
    var dur = snap.duration || 0;
    var frac = (dur > 0) ? (snap.position / dur) : 0;
    var pct = Math.min(100, Math.max(0, frac * 100));

    if (!userSeeking) {
      timeCur.textContent = ui.fmtTime(snap.position);
      timeTotal.textContent = ui.fmtTime(dur);
      seekRange.value = Math.round(frac * 1000);
      seekRange.style.setProperty('--um-fill', pct + '%');
      miniProgressFill.style.width = pct + '%';
    }

    syncSheetSeek(frac, dur);

    volRange.value = Math.round(snap.volume * 100);
    volRange.style.setProperty('--um-fill', (snap.volume * 100) + '%');
    muteBtn.innerHTML = snap.volume <= 0.001 ? icon('volMute') : icon('volHigh');
    fullVolRange.value = Math.round(snap.volume * 100);
    fullVolRange.style.setProperty('--um-fill', (snap.volume * 100) + '%');
    fullVolPct.textContent = Math.round(snap.volume * 100) + '%';
    fullMuteBtn.innerHTML = snap.volume <= 0.001 ? icon('volMute') : icon('volHigh');

    syncLyricsPosition(snap.position);
  });

  player.on('queue', function () {
    if (state.queueOpen) renderQueueDrawer();
    if (state.nowSheetOpen && state.sheetTab === 'next') renderSheetNextList();
    var nextCard = npBody.querySelector('.um-np-next');
    if (nextCard) buildNextQueueCard(nextCard);
  });

  player.on('played', function (track) {
    core.recordHistory(track);
  });

  player.on('error', function (err) {
    ui.toast(err.message || 'Playback error', 'error');
  });

  core.on('library', function () {
    renderLibList();
    updateLikeButtons();
    var cur = player.current();
    if (cur) pbLikeBtn.classList.toggle('um-like--on', core.isLiked(cur.id));
  });

  /* ------------------------------------------------------------------ *
   * Router Dispatch
   * ------------------------------------------------------------------ */
  function router() {
    var hash = window.location.hash || '#/home';
    state.currentPath = hash;
    var raw = hash.slice(1);
    var parts = raw.split('?');
    var path = parts[0] || '/home';
    var qStr = parts[1] || '';
    var params = {};
    if (qStr) {
      var usp = new URLSearchParams(qStr);
      usp.forEach(function (v, k) { params[k] = v; });
    }

    updateBnavActive(hash);
    centerView.scrollTop = 0;
    var gen = ++state.routeGen;

    /* Auth check: if route is not login/register and user is not authed, show login */
    if (!core.token() && path !== '/login' && path !== '/register') {
      if (UM.views && UM.views.login) {
        UM.views.login(centerView, params);
      }
      return;
    }

    /* Route dispatching */
    if (path === '/home' || path === '') {
      dispatchView('home', params, gen);
    } else if (path === '/search') {
      dispatchView('search', params, gen);
    } else if (path.indexOf('/album/') === 0) {
      params.id = decodeURIComponent(path.slice(7));
      dispatchView('album', params, gen);
    } else if (path.indexOf('/artist/') === 0) {
      params.id = decodeURIComponent(path.slice(8));
      dispatchView('artist', params, gen);
    } else if (path.indexOf('/playlist/') === 0) {
      params.id = decodeURIComponent(path.slice(10));
      dispatchView('playlist', params, gen);
    } else if (path.indexOf('/mix/') === 0) {
      params.id = decodeURIComponent(path.slice(5));
      dispatchView('mix', params, gen);
    } else if (path === '/mood' || path.indexOf('/mood') === 0) {
      dispatchView('mood', params, gen);
    } else if (path === '/library') {
      dispatchView('library', params, gen);
    } else if (path === '/liked') {
      dispatchView('liked', params, gen);
    } else if (path === '/history') {
      dispatchView('history', params, gen);
    } else if (path.indexOf('/userpl/') === 0) {
      params.id = decodeURIComponent(path.slice(8));
      params.isUserPlaylist = true;
      dispatchView('playlist', params, gen);
    } else if (path === '/settings') {
      dispatchView('settings', params, gen);
    } else if (path === '/stats') {
      dispatchView('stats', params, gen);
    } else if (path === '/login') {
      dispatchView('login', params, gen);
    } else if (path === '/register') {
      dispatchView('register', params, gen);
    } else {
      dispatchView('home', params, gen);
    }
  }

  function dispatchView(name, params, gen) {
    if (!UM.views || typeof UM.views[name] !== 'function') {
      centerView.innerHTML = '';
      centerView.appendChild(h('div', { className: 'um-empty', style: 'padding:50px;' },
        h('div', { className: 'um-empty-title', text: 'View not found' })
      ));
      return;
    }

    try {
      var res = UM.views[name](centerView, params);
      if (res && typeof res.then === 'function') {
        res.catch(function (err) {
          if (gen === state.routeGen) {
            ui.toast(err.message || 'Error loading page', 'error');
          }
        });
      }
    } catch (e) {
      console.error('[UM.app] View render error in ' + name + ':', e);
      ui.toast('Failed to load view', 'error');
    }
  }

  window.addEventListener('hashchange', router);

  /* Set soft vertical tint gradient */
  UM.setPageTint = function (url) {
    ui.dominantColor(url).then(function (rgb) {
      document.documentElement.style.setProperty('--um-tint', rgb);
    });
  };

  /* ------------------------------------------------------------------ *
   * Keyboard Shortcuts
   * ------------------------------------------------------------------ */
  window.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) {
      if (e.key === 'Escape') {
        e.target.blur();
        closeSuggestions();
      }
      return;
    }

    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      player.toggle();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.shiftKey) player.prev();
      else player.seek((player.state.position || 0) - 5);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.shiftKey) player.next();
      else player.seek((player.state.position || 0) + 5);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      var upV = Math.min(1, player.state.volume + 0.05);
      player.setVolume(upV);
      core.lib.settings.volume = upV;
      scheduleSaveSettings();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      var dnV = Math.max(0, player.state.volume - 0.05);
      player.setVolume(dnV);
      core.lib.settings.volume = dnV;
      scheduleSaveSettings();
    } else if (e.key === 'l' || e.key === 'L') {
      var cur = player.current();
      if (cur) core.toggleLike(cur);
    } else if (e.key === '/') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    } else if (e.key === 'q' || e.key === 'Q') {
      toggleQueue();
    } else if (e.key === 'Escape') {
      var existingMenu = document.querySelector('.um-menu');
      if (existingMenu && existingMenu.parentNode) {
        existingMenu.parentNode.removeChild(existingMenu);
      }
      if (state.nowSheetOpen) closeNowSheet();
      if (state.queueOpen) toggleQueue(false);
      if (state.libOpen) toggleMobileLib(false);
      closeSuggestions();
    }
  });

  /* ------------------------------------------------------------------ *
   * Service Worker & PWA Updates
   * ------------------------------------------------------------------ */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      var isFirstController = !navigator.serviceWorker.controller;
      var userAcceptedReload = false;

      navigator.serviceWorker.register('./sw.js', { scope: './' })
        .then(function (reg) {
          if (!reg) return;
          if (reg.waiting) {
            showUpdateToast(reg.waiting);
            return;
          }
          reg.addEventListener('updatefound', function () {
            var worker = reg.installing;
            if (!worker) return;
            worker.addEventListener('statechange', function () {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateToast(worker);
              }
            });
          });
        })
        .catch(function () {});

      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (isFirstController) {
          isFirstController = false;
          return;
        }
        if (userAcceptedReload) {
          window.location.reload();
        }
      });

      function showUpdateToast(worker) {
        var toastContainer = document.querySelector('.um-toasts');
        if (!toastContainer) {
          toastContainer = h('div', { className: 'um-toasts' });
          document.body.appendChild(toastContainer);
        }
        var t = h('div', { className: 'um-toast um-toast--update' },
          h('span', { text: 'New version available' }),
          h('button', {
            className: 'um-toast-action',
            text: 'Reload',
            style: 'min-height:36px;',
            onClick: function () {
              userAcceptedReload = true;
              if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
              else window.location.reload();
            }
          })
        );
        toastContainer.appendChild(t);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Boot Sequence & Session Clearing
   * ------------------------------------------------------------------ */
  function clearUserSession() {
    player.stop();
    player.playList([], 0);
    try { localStorage.removeItem('um.session'); } catch (e) {}
    state.lyricsData = null;
    state.lyricsTrackId = null;
    state.activeLyricIdx = -1;
    state.activePreviewLyricIdx = -1;
    syncTrackUI(null);
    centerView.innerHTML = '';
    renderLibList();
  }

  core.onAuthRequired = function () {
    clearUserSession();
    ui.nav('#/login');
  };

  core.on('auth', function (evt) {
    if (evt && evt.authenticated) {
      core.loadLibrary().then(function (lib) {
        applySettingsToPlayer(lib.settings);
        renderLibList();
        player.restore();
        ui.nav('#/home');
      }).catch(function () {
        ui.nav('#/home');
      });
    } else {
      clearUserSession();
      ui.nav('#/login');
    }
  });

  function applySettingsToPlayer(settings) {
    if (!settings) return;
    if (settings.volume != null) player.setVolume(settings.volume);
    if (settings.shuffle != null) player.setShuffle(settings.shuffle);
    if (settings.repeat) player.setRepeat(settings.repeat);
    if (settings.crossfade != null) player.setCrossfade(settings.crossfade);
  }

  function boot() {
    renderLibList();
    syncPanelLayout();

    if (core.token()) {
      /* Draw straight away from this device's cached copy, then refresh. */
      var hadCache = core.loadCachedLibrary();
      if (hadCache) {
        applySettingsToPlayer(core.lib.settings);
        renderLibList();
        player.restore();
        router();
      }
      core.loadLibrary()
        .then(function (lib) {
          if (!hadCache) {
            applySettingsToPlayer(lib.settings);
            player.restore();
            router();
          }
          renderLibList();
        })
        .catch(function () {
          renderLibList();
          if (!hadCache) router();
        });
    } else {
      router();
    }
  }

  boot();
})();
