/* UTSHOW Music (web) — views.js (v1.2)
 * Pure vanilla page renderers for UM.views:
 * home, search, album, artist, playlist, mix, mood, library, liked,
 * history, settings, stats, login, register.
 * Built strictly against core.js (UM.core, UM.ui) and app.css class names.
 *
 * Every view entry invalidates pending work via a monotonic view token, so
 * stale responses can never repaint a newer page (including the login screen).
 */
(function () {
  'use strict';

  var UM = window.UM || (window.UM = {});
  var ui = UM.ui;
  var core = UM.core;
  var h = ui.h;
  var icon = ui.icon;

  var views = {};
  var viewToken = 0;

  /* ==================================================================== *
   * Small internal helpers
   * ==================================================================== */

  function beginView() {
    viewToken += 1;
    return viewToken;
  }

  function active(token) {
    return token === viewToken;
  }

  function clearView(container) {
    while (container && container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  var DEFAULT_TINT = 'rgba(31, 111, 224, 0.28)';

  function applyTint(color) {
    try {
      document.documentElement.style.setProperty('--um-tint', color || DEFAULT_TINT);
    } catch (e) {}
  }

  function isImageUrl(u) {
    return typeof u === 'string' && /^(https?:\/\/|\/\/|\/)/.test(u);
  }

  /* Only ever pass real image URLs here; pass null/undefined for the default
     tint. Colour strings are handled by applyTint() instead. */
  function setPageTint(artUrl, token) {
    applyTint(DEFAULT_TINT);
    if (!isImageUrl(artUrl)) return;
    if (!ui.dominantColor) return;
    ui.dominantColor(artUrl).then(function (rgb) {
      if (token != null && token !== viewToken) return;
      applyTint(rgb);
    }).catch(function () {});
  }

  function showError(container, message, retryFn) {
    clearView(container);
    var box = h('div', { className: 'um-empty' },
      h('div', { className: 'um-empty-icon', html: icon('note') }),
      h('div', { className: 'um-empty-title', text: 'Something went wrong' }),
      h('div', { className: 'um-empty-text', text: message || 'Could not load this page.' })
    );
    if (retryFn) {
      box.appendChild(h('button', {
        className: 'um-btn um-btn--accent um-mt16',
        text: 'Retry',
        onClick: retryFn
      }));
    }
    container.appendChild(box);
  }

  /* ------------------------------------------------------------ saving */

  var libSaveTimer = null;
  var libSaveInFlight = false;

  function flushLibrarySave() {
    if (!core || typeof core.saveLibrary !== 'function') return;
    if (libSaveInFlight) {
      scheduleLibrarySave();
      return;
    }
    libSaveInFlight = true;
    var done = function () { libSaveInFlight = false; };
    try {
      var p = core.saveLibrary();
      if (p && typeof p.then === 'function') p.then(done, done);
      else done();
    } catch (e) {
      done();
    }
  }

  function scheduleLibrarySave() {
    if (libSaveTimer) clearTimeout(libSaveTimer);
    libSaveTimer = setTimeout(function () {
      libSaveTimer = null;
      flushLibrarySave();
    }, 800);
  }

  /* ------------------------------------------------- playback provenance */

  function tagSource(tracks, source, auto) {
    if (!tracks) return tracks;
    for (var i = 0; i < tracks.length; i++) {
      if (!tracks[i]) continue;
      try {
        tracks[i]._umSource = source || null;
        tracks[i]._umAuto = !!auto;
      } catch (e) {}
    }
    return tracks;
  }

  function playTracks(tracks, index, source, auto) {
    if (!tracks || !tracks.length) return;
    tagSource(tracks, source, auto);
    if (!UM.player) return;
    var start = index || 0;
    if (start < 0) start = 0;
    if (start >= tracks.length) start = 0;
    UM.player.playList(tracks, start);
  }

  function playOneTrack(track, source, auto) {
    if (!track || !UM.player) return;
    tagSource([track], source, auto);
    UM.player.playOne(track);
  }

  /* Builds a shared track list and stamps the recommendation source onto each
     row so downstream handlers can attribute plays/skips. */
  function listWithSource(tracks, opts, source) {
    var el = ui.trackList(tracks, opts || {});
    try {
      var rows = el.querySelectorAll('.um-track');
      for (var i = 0; i < rows.length; i++) {
        rows[i].dataset.umSource = source || '';
      }
    } catch (e) {}
    return el;
  }

  /* ------------------------------------------------------- misc helpers */

  function copyText(text) {
    var ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          ui.toast('Copied');
        }, function () {
          ui.toast('Copy failed', 'error');
        });
        return;
      }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {
      ok = false;
    }
    if (ok) ui.toast('Copied');
    else ui.toast('Copy failed', 'error');
  }

  function svgEl(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          el.setAttribute(k, String(attrs[k]));
        }
      }
    }
    return el;
  }

  /* ==================================================================== *
   * VIEW: Home
   * ==================================================================== */
  views.home = function (container) {
    var token = beginView();
    clearView(container);
    setPageTint(null, token);

    var me = core.me() || {};
    var userName = me.name || 'you';

    /* skeleton shimmer */
    var skel = h('div', {});
    skel.appendChild(h('div', { className: 'um-search-tabs', style: 'padding-top:16px;' },
      h('div', { className: 'um-skel', style: 'height:32px;width:190px;border-radius:999px;' })
    ));
    var skelGrid = h('div', { className: 'um-shortcuts' });
    for (var s = 0; s < 8; s++) {
      skelGrid.appendChild(h('div', { className: 'um-skel um-skel-tile' }));
    }
    skel.appendChild(skelGrid);
    var skelRow = h('div', { className: 'um-row' });
    skelRow.appendChild(ui.skeleton('card', 6));
    skel.appendChild(skelRow);
    container.appendChild(skel);

    var homeData = { charts: [], moods: [] };
    var polled = false;

    function maybePoll(md) {
      if (polled || !md || md.refined !== false) return;
      polled = true;
      setTimeout(function () {
        if (!active(token)) return;
        UM.req('/api/mixes').then(function (d) {
          if (!active(token) || !d) return;
          if (d.mixes && d.mixes.length) render(homeData, d);
        }).catch(function () {});
      }, 30000);
    }

    function render(hd, md) {
      if (!active(token)) return;
      clearView(container);

      var mixesList = (md.mixes || []).filter(function (m) {
        return m && m.tracks && m.tracks.length;
      });
      var stations = md.stations || [];
      var charts = hd.charts || [];
      var moods = hd.moods || [];

      for (var mi = 0; mi < mixesList.length; mi++) {
        tagSource(mixesList[mi].tracks, 'mix:' + mixesList[mi].id, true);
      }

      /* filter pills */
      container.appendChild(h('div', { className: 'um-search-tabs', style: 'padding-top:16px;' },
        h('button', { className: 'um-tab um-tab--active', text: 'All' }),
        h('button', {
          className: 'um-tab',
          text: 'Music',
          onClick: function () { ui.nav('#/search?q=top%20hits&type=songs'); }
        }),
        h('button', {
          className: 'um-tab',
          text: 'Mixes',
          onClick: function () {
            if (mixesList.length) ui.nav('#/mix/' + encodeURIComponent(mixesList[0].id));
            else ui.toast('Play a few songs to unlock mixes');
          }
        })
      ));

      /* shortcut tiles (2 x 4) */
      var grid = h('div', { className: 'um-shortcuts' });
      var tiles = [];

      tiles.push(ui.shortcutTile({
        title: 'Liked Songs',
        art: null,
        isLiked: true,
        onClick: function () { ui.nav('#/liked'); },
        onPlay: function () {
          var liked = core.lib.liked || [];
          if (liked.length) playTracks(liked, 0, 'liked', false);
          else ui.toast('No liked songs yet');
        }
      }));

      for (var mIdx = 0; mIdx < mixesList.length && tiles.length < 4; mIdx++) {
        (function (m) {
          tiles.push(ui.shortcutTile({
            title: m.title,
            art: (m.covers && m.covers[0]) || null,
            onClick: function () { ui.nav('#/mix/' + encodeURIComponent(m.id)); },
            onPlay: function () {
              if (m.tracks && m.tracks.length) playTracks(m.tracks, 0, 'mix:' + m.id, true);
            }
          }));
        })(mixesList[mIdx]);
      }

      var countMap = {};
      var hist = core.lib.history || [];
      for (var hi = 0; hi < hist.length; hi++) {
        var trk = hist[hi];
        if (!trk || !trk.id) continue;
        var key = trk.albumId ? ('alb:' + trk.albumId)
          : (trk.artistId ? ('art:' + trk.artistId) : ('trk:' + trk.id));
        if (!countMap[key]) {
          countMap[key] = {
            count: 0,
            title: trk.album || trk.artists || trk.title,
            art: trk.art || trk.thumb,
            track: trk,
            kind: trk.albumId ? 'album' : (trk.artistId ? 'artist' : 'track'),
            id: trk.albumId || trk.artistId || trk.id
          };
        }
        countMap[key].count += 1;
      }
      var sorted = Object.keys(countMap).map(function (k) { return countMap[k]; })
        .sort(function (a, b) { return b.count - a.count; });

      for (var si = 0; si < sorted.length && tiles.length < 8; si++) {
        (function (item) {
          tiles.push(ui.shortcutTile({
            title: item.title,
            art: item.art,
            onClick: function () {
              if (item.kind === 'album') ui.nav('#/album/' + encodeURIComponent(item.id));
              else if (item.kind === 'artist') ui.nav('#/artist/' + encodeURIComponent(item.id));
              else playOneTrack(item.track, 'history', false);
            },
            onPlay: function () { playOneTrack(item.track, 'history', false); }
          }));
        })(sorted[si]);
      }

      for (var ci = 0; ci < charts.length && tiles.length < 8; ci++) {
        (function (ct, idx) {
          tiles.push(ui.shortcutTile({
            title: ct.title,
            art: ct.art || ct.thumb,
            onClick: function () { playTracks(charts, idx, 'charts', false); },
            onPlay: function () { playTracks(charts, idx, 'charts', false); }
          }));
        })(charts[ci], ci);
      }

      for (var t = 0; t < tiles.length && t < 8; t++) {
        grid.appendChild(tiles[t]);
      }
      container.appendChild(grid);

      /* "Made for <name>" */
      if (mixesList.length) {
        var mixCards = [];
        for (var mc = 0; mc < mixesList.length; mc++) {
          mixCards.push(ui.mixCard(mixesList[mc], mc + 1));
        }
        container.appendChild(ui.section(
          'Made for ' + userName,
          'Made For',
          mixCards,
          {
            showAll: function () {
              if (mixesList[0]) ui.nav('#/mix/' + encodeURIComponent(mixesList[0].id));
            }
          }
        ));
      } else {
        container.appendChild(h('div', { className: 'um-section' },
          h('div', { className: 'um-empty', style: 'padding:28px 16px;' },
            h('div', { className: 'um-empty-icon', html: icon('radio') }),
            h('div', { className: 'um-empty-title', text: 'Play a few songs and your mixes will appear here' }),
            h('div', { className: 'um-empty-text', text: 'Daily mixes, Discover and On Repeat are built from what you listen to.' })
          )
        ));
      }

      /* Recommended stations */
      if (stations.length) {
        var stCards = [];
        for (var st = 0; st < stations.length; st++) {
          stCards.push(ui.stationCard(stations[st]));
        }
        container.appendChild(ui.section(
          'Recommended stations',
          'Non-stop music based on your favorite songs and artists.',
          stCards
        ));
      }

      /* Charts */
      if (charts.length) {
        var chartCards = [];
        for (var ch = 0; ch < charts.length; ch++) {
          (function (ct, idx) {
            chartCards.push(ui.card({
              id: ct.id,
              title: ct.title,
              artists: ct.artists,
              art: ct.art || ct.thumb,
              onClick: function () { playTracks(charts, idx, 'charts', false); },
              onPlay: function () { playTracks(charts, idx, 'charts', false); }
            }, 'track'));
          })(charts[ch], ch);
        }
        container.appendChild(ui.section('Charts', '', chartCards));
      }

      /* Moods & genres */
      if (moods.length) {
        var moodSec = h('div', { className: 'um-section' },
          h('div', { className: 'um-section-head' },
            h('h2', { className: 'um-section-title', text: 'Moods & Genres' })
          )
        );
        var chipWrap = h('div', { className: 'um-chips', style: 'padding-left:0;padding-right:0;' });
        for (var md2 = 0; md2 < moods.length; md2++) {
          (function (m) {
            chipWrap.appendChild(h('button', {
              className: 'um-chip',
              text: m.title,
              onClick: function () {
                ui.nav('#/mood?params=' + encodeURIComponent(m.params) + '&title=' + encodeURIComponent(m.title));
              }
            }));
          })(moods[md2]);
        }
        moodSec.appendChild(chipWrap);
        container.appendChild(moodSec);
      }
    }

    Promise.all([
      UM.req('/api/home').catch(function () { return { charts: [], moods: [] }; }),
      UM.req('/api/mixes').catch(function () { return { mixes: [], stations: [], refined: true }; })
    ]).then(function (res) {
      if (!active(token)) return;
      homeData = res[0] || { charts: [], moods: [] };
      var mixData = res[1] || { mixes: [], stations: [], refined: true };
      render(homeData, mixData);
      maybePoll(mixData);
    }).catch(function (err) {
      if (!active(token)) return;
      showError(container, err && err.message, function () { views.home(container); });
    });
  };

  /* ==================================================================== *
   * VIEW: Search
   * ==================================================================== */
  views.search = function (container, params) {
    var token = beginView();
    clearView(container);
    setPageTint(null, token);

    params = params || {};
    var query = (params.q || '').trim();
    var type = (params.type || 'all').toLowerCase();

    var page = h('div', { className: 'um-search-page' });
    container.appendChild(page);

    var tabs = ['all', 'songs', 'albums', 'artists', 'playlists'];
    var tabRow = h('div', { className: 'um-search-tabs' });
    for (var i = 0; i < tabs.length; i++) {
      (function (t) {
        tabRow.appendChild(h('button', {
          className: 'um-tab' + (t === type ? ' um-tab--active' : ''),
          text: t.charAt(0).toUpperCase() + t.slice(1),
          onClick: function () {
            ui.nav('#/search?q=' + encodeURIComponent(query) + '&type=' + t);
          }
        }));
      })(tabs[i]);
    }
    page.appendChild(tabRow);

    if (!query) {
      page.appendChild(h('div', { className: 'um-empty' },
        h('div', { className: 'um-empty-icon', html: icon('search') }),
        h('div', { className: 'um-empty-title', text: 'Search UTSHOW Music' }),
        h('div', { className: 'um-empty-text', text: 'Find your favorite songs, artists, albums, and playlists.' })
      ));
      return;
    }

    var resultsBox = h('div', {});
    resultsBox.appendChild(h('div', { className: 'um-grid' }, ui.skeleton('card', 8)));
    page.appendChild(resultsBox);

    UM.req('/api/search?q=' + encodeURIComponent(query) + '&type=' + encodeURIComponent(type))
      .then(function (res) {
        if (!active(token)) return;
        res = res || {};
        clearView(resultsBox);

        if (type === 'all') {
          var hasTop = !!res.top;
          var songs = res.songs || [];
          if (hasTop || songs.length) {
            var topSec = h('div', { className: 'um-section' });
            var gridTwo = h('div', {
              style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;align-items:start;'
            });

            if (hasTop) {
              var topTrack = res.top;
              gridTwo.appendChild(h('div', { className: 'um-topresult-card' },
                h('div', { className: 'um-topresult-art' }, ui.img(topTrack.art || topTrack.thumb, '')),
                h('div', { className: 'um-topresult-meta' },
                  h('div', { className: 'um-card-title', text: topTrack.title || '' }),
                  h('div', { className: 'um-card-sub', text: 'Song • ' + (topTrack.artists || '') })
                ),
                h('button', {
                  className: 'um-btn um-btn--accent um-mt8',
                  html: icon('play'),
                  children: [document.createTextNode(' Play')],
                  onClick: function () { playOneTrack(topTrack, 'search', false); }
                })
              ));
            }

            if (songs.length) {
              gridTwo.appendChild(h('div', {},
                h('h3', { className: 'um-section-title', style: 'font-size:18px;margin:0 0 8px;', text: 'Songs' }),
                listWithSource(songs.slice(0, 5), {
                  onPlayTrack: function (idx) { playTracks(songs, idx, 'search', false); }
                }, 'search')
              ));
            }

            topSec.appendChild(gridTwo);
            resultsBox.appendChild(topSec);
          }

          if (res.albums && res.albums.length) {
            var albCards = [];
            for (var a = 0; a < res.albums.length; a++) albCards.push(ui.card(res.albums[a], 'album'));
            resultsBox.appendChild(ui.section('Albums', '', albCards));
          }

          if (res.artists && res.artists.length) {
            var artCards = [];
            for (var ar = 0; ar < res.artists.length; ar++) artCards.push(ui.card(res.artists[ar], 'artist'));
            resultsBox.appendChild(ui.section('Artists', '', artCards));
          }

          if (res.playlists && res.playlists.length) {
            var plCards = [];
            for (var p = 0; p < res.playlists.length; p++) plCards.push(ui.card(res.playlists[p], 'playlist'));
            resultsBox.appendChild(ui.section('Playlists', '', plCards));
          }

          if (!hasTop && !songs.length &&
            !(res.albums && res.albums.length) &&
            !(res.artists && res.artists.length) &&
            !(res.playlists && res.playlists.length)) {
            resultsBox.appendChild(h('div', { className: 'um-empty' },
              h('div', { className: 'um-empty-title', text: 'No results found' }),
              h('div', { className: 'um-empty-text', text: 'Try a different search.' })
            ));
          }
        } else {
          var items = res.items || [];
          if (!items.length) {
            resultsBox.appendChild(h('div', { className: 'um-empty' },
              h('div', { className: 'um-empty-icon', html: icon('search') }),
              h('div', { className: 'um-empty-title', text: 'No results found' })
            ));
            return;
          }
          if (type === 'songs') {
            resultsBox.appendChild(listWithSource(items, {
              onPlayTrack: function (idx) { playTracks(items, idx, 'search', false); }
            }, 'search'));
          } else {
            var grid = h('div', { className: 'um-grid' });
            var kind = type === 'albums' ? 'album' : (type === 'artists' ? 'artist' : 'playlist');
            for (var it = 0; it < items.length; it++) {
              grid.appendChild(ui.card(items[it], kind));
            }
            resultsBox.appendChild(grid);
          }
        }
      })
      .catch(function (err) {
        if (!active(token)) return;
        clearView(resultsBox);
        resultsBox.appendChild(h('div', { className: 'um-empty' },
          h('div', { className: 'um-empty-icon', html: icon('search') }),
          h('div', { className: 'um-empty-title', text: 'Search failed' }),
          h('div', { className: 'um-empty-text', text: (err && err.message) || 'Please try again.' }),
          h('button', {
            className: 'um-btn um-btn--accent um-mt16',
            text: 'Retry',
            onClick: function () { views.search(container, params); }
          })
        ));
      });
  };

  /* ==================================================================== *
   * VIEW: Album
   * ==================================================================== */
  views.album = function (container, params) {
    var token = beginView();
    clearView(container);
    setPageTint(null, token);
    params = params || {};
    var browseId = params.id || '';

    container.appendChild(h('div', { className: 'um-skel', style: 'height:240px;margin:24px;' }));

    UM.req('/api/album/' + encodeURIComponent(browseId))
      .then(function (data) {
        if (!active(token)) return;
        clearView(container);

        data = data || {};
        var album = data.album || {};
        var tracks = data.tracks || [];
        setPageTint(album.art, token);

        var totalDur = 0;
        for (var d = 0; d < tracks.length; d++) totalDur += (tracks[d].duration || 0);

        var hero = h('div', { className: 'um-hero' },
          h('div', { className: 'um-hero-art' }, ui.img(album.art, '')),
          h('div', { className: 'um-hero-info' },
            h('div', { className: 'um-hero-eyebrow', text: 'Album' }),
            h('h1', { className: 'um-hero-title', text: album.title || 'Untitled Album' }),
            h('div', { className: 'um-hero-meta' },
              h('strong', { text: album.artists || 'Unknown Artist' }),
              h('span', { className: 'um-dot', text: '•' }),
              h('span', { text: album.year ? String(album.year) : '' }),
              h('span', { className: 'um-dot', text: '•' }),
              h('span', { text: tracks.length + ' songs, ' + ui.fmtTime(totalDur) })
            ),
            h('div', { className: 'um-hero-actions' },
              h('button', {
                className: 'um-btn um-btn--accent',
                html: icon('play'),
                children: [document.createTextNode(' Play')],
                onClick: function () { playTracks(tracks, 0, 'album', false); }
              }),
              h('button', {
                className: 'um-btn um-btn--ghost',
                html: icon('shuffle'),
                children: [document.createTextNode(' Shuffle')],
                onClick: function () {
                  if (!tracks.length || !UM.player) return;
                  UM.player.setShuffle(true);
                  core.lib.settings.shuffle = true;
                  scheduleLibrarySave();
                  playTracks(tracks, 0, 'album', false);
                }
              }),
              h('button', {
                className: 'um-btn um-btn--ghost',
                text: 'Like all',
                onClick: function () {
                  var liked = core.lib.liked || (core.lib.liked = []);
                  var added = 0;
                  for (var i = 0; i < tracks.length; i++) {
                    var t = tracks[i];
                    if (!t || !t.id) continue;
                    if (!core.isLiked(t.id)) {
                      liked.unshift(t);
                      core.feedback('like', t, { listenedSec: 0, duration: t.duration || 0 });
                      added += 1;
                    }
                  }
                  if (added > 0) {
                    core.emit('library', core.lib);
                    scheduleLibrarySave();
                    ui.toast('Added ' + added + ' song' + (added === 1 ? '' : 's') + ' to Liked Songs');
                  } else {
                    ui.toast('All songs are already liked');
                  }
                }
              })
            )
          )
        );

        container.appendChild(hero);
        container.appendChild(listWithSource(tracks, {
          noArt: true,
          onPlayTrack: function (idx) { playTracks(tracks, idx, 'album', false); }
        }, 'album'));
      })
      .catch(function (err) {
        if (!active(token)) return;
        showError(container, err && err.message, function () { views.album(container, params); });
      });
  };

  /* ==================================================================== *
   * VIEW: Artist
   * ==================================================================== */
  views.artist = function (container, params) {
    var token = beginView();
    clearView(container);
    setPageTint(null, token);
    params = params || {};
    var channelId = params.id || '';

    container.appendChild(h('div', { className: 'um-skel', style: 'height:240px;margin:24px;' }));

    UM.req('/api/artist/' + encodeURIComponent(channelId))
      .then(function (data) {
        if (!active(token)) return;
        clearView(container);

        data = data || {};
        var artist = data.artist || {};
        var songs = data.songs || [];
        var albums = data.albums || [];
        setPageTint(artist.art, token);

        var hero = h('div', { className: 'um-hero' },
          h('div', { className: 'um-hero-art', style: 'border-radius:50%;' }, ui.img(artist.art, '')),
          h('div', { className: 'um-hero-info' },
            h('div', { className: 'um-hero-eyebrow', text: 'Artist' }),
            h('h1', { className: 'um-hero-title', text: artist.name || 'Artist' }),
            h('div', { className: 'um-hero-actions' },
              h('button', {
                className: 'um-btn um-btn--accent',
                html: icon('play'),
                children: [document.createTextNode(' Play')],
                onClick: function () { playTracks(songs, 0, 'artist', false); }
              }),
              h('button', {
                className: 'um-btn um-btn--ghost',
                html: icon('radio'),
                children: [document.createTextNode(' Artist Radio')],
                onClick: function () {
                  if (songs.length) playOneTrack(songs[0], 'artist', true);
                }
              })
            )
          )
        );
        container.appendChild(hero);

        if (songs.length) {
          container.appendChild(h('div', { className: 'um-section' },
            h('h2', { className: 'um-section-title', text: 'Popular Songs' })
          ));
          container.appendChild(listWithSource(songs, {
            onPlayTrack: function (idx) { playTracks(songs, idx, 'artist', false); }
          }, 'artist'));
        }

        if (albums.length) {
          var albCards = [];
          for (var i = 0; i < albums.length; i++) albCards.push(ui.card(albums[i], 'album'));
          container.appendChild(ui.section('Discography', '', albCards));
        }
      })
      .catch(function (err) {
        if (!active(token)) return;
        showError(container, err && err.message, function () { views.artist(container, params); });
      });
  };

  /* ==================================================================== *
   * VIEW: Playlist (upstream)
   * ==================================================================== */
  views.playlist = function (container, params) {
    var token = beginView();
    clearView(container);
    setPageTint(null, token);
    params = params || {};
    var pid = params.id || '';

    container.appendChild(h('div', { className: 'um-skel', style: 'height:240px;margin:24px;' }));

    UM.req('/api/playlist/' + encodeURIComponent(pid))
      .then(function (data) {
        if (!active(token)) return;
        clearView(container);

        data = data || {};
        var pl = data.playlist || {};
        var tracks = data.tracks || [];
        setPageTint(pl.art, token);

        var hero = h('div', { className: 'um-hero' },
          h('div', { className: 'um-hero-art' }, ui.img(pl.art, '')),
          h('div', { className: 'um-hero-info' },
            h('div', { className: 'um-hero-eyebrow', text: 'Playlist' }),
            h('h1', { className: 'um-hero-title', text: pl.title || 'Playlist' }),
            h('div', { className: 'um-hero-meta' },
              h('strong', { text: pl.author || 'YouTube Music' }),
              h('span', { className: 'um-dot', text: '•' }),
              h('span', { text: tracks.length + ' songs' })
            ),
            h('div', { className: 'um-hero-actions' },
              h('button', {
                className: 'um-btn um-btn--accent',
                html: icon('play'),
                children: [document.createTextNode(' Play')],
                onClick: function () { playTracks(tracks, 0, 'playlist', false); }
              }),
              h('button', {
                className: 'um-btn um-btn--ghost',
                html: icon('shuffle'),
                children: [document.createTextNode(' Shuffle')],
                onClick: function () {
                  if (!tracks.length || !UM.player) return;
                  UM.player.setShuffle(true);
                  core.lib.settings.shuffle = true;
                  scheduleLibrarySave();
                  playTracks(tracks, 0, 'playlist', false);
                }
              })
            )
          )
        );

        container.appendChild(hero);
        container.appendChild(listWithSource(tracks, {
          onPlayTrack: function (idx) { playTracks(tracks, idx, 'playlist', false); }
        }, 'playlist'));
      })
      .catch(function (err) {
        if (!active(token)) return;
        showError(container, err && err.message, function () { views.playlist(container, params); });
      });
  };

  /* ==================================================================== *
   * VIEW: Mix
   * ==================================================================== */
  views.mix = function (container, params) {
    var token = beginView();
    clearView(container);
    setPageTint(null, token);
    params = params || {};
    var mixId = params.id || '';

    container.appendChild(h('div', { className: 'um-skel', style: 'height:240px;margin:24px;' }));

    UM.req('/api/mix/' + encodeURIComponent(mixId))
      .then(function (data) {
        if (!active(token)) return;
        clearView(container);

        data = data || {};
        var mix = data.mix || {};
        var tracks = data.tracks || [];
        var art = (mix.covers && mix.covers[0]) || (tracks[0] && tracks[0].art) || null;
        setPageTint(art, token);

        var source = 'mix:' + mixId;
        tagSource(tracks, source, true);

        var hero = h('div', { className: 'um-hero' },
          h('div', { className: 'um-hero-art' }, ui.img(art, '')),
          h('div', { className: 'um-hero-info' },
            h('div', { className: 'um-hero-eyebrow', text: 'Mix' }),
            h('h1', { className: 'um-hero-title', text: mix.title || 'Mix' }),
            h('div', { className: 'um-hero-meta' },
              h('span', { text: mix.subtitle || 'Personalized mix' }),
              h('span', { className: 'um-dot', text: '•' }),
              h('span', { text: tracks.length + ' tracks' })
            ),
            h('div', { className: 'um-hero-actions' },
              h('button', {
                className: 'um-btn um-btn--accent',
                html: icon('play'),
                children: [document.createTextNode(' Play')],
                onClick: function () { playTracks(tracks, 0, source, true); }
              }),
              h('button', {
                className: 'um-btn um-btn--ghost',
                html: icon('shuffle'),
                children: [document.createTextNode(' Shuffle')],
                onClick: function () {
                  if (!tracks.length || !UM.player) return;
                  UM.player.setShuffle(true);
                  core.lib.settings.shuffle = true;
                  scheduleLibrarySave();
                  playTracks(tracks, 0, source, true);
                }
              })
            )
          )
        );

        container.appendChild(hero);

        if (!tracks.length) {
          container.appendChild(h('div', { className: 'um-empty' },
            h('div', { className: 'um-empty-icon', html: icon('radio') }),
            h('div', { className: 'um-empty-title', text: 'Mix is warming up' }),
            h('div', { className: 'um-empty-text', text: 'Play a few songs and check back shortly.' })
          ));
          return;
        }

        container.appendChild(listWithSource(tracks, {
          onPlayTrack: function (idx) { playTracks(tracks, idx, source, true); }
        }, source));
      })
      .catch(function (err) {
        if (!active(token)) return;
        showError(container, err && err.message, function () { views.mix(container, params); });
      });
  };

  /* ==================================================================== *
   * VIEW: Mood / genre playlist grid
   * ==================================================================== */
  views.mood = function (container, params) {
    var token = beginView();
    clearView(container);
    setPageTint(null, token);
    params = params || {};
    var moodParams = params.params || '';
    var title = params.title || 'Mood';

    container.appendChild(h('div', { className: 'um-section' },
      h('h1', { className: 'um-section-title', style: 'font-size:32px;', text: title })
    ));

    var grid = h('div', { className: 'um-grid' });
    grid.appendChild(ui.skeleton('card', 8));
    container.appendChild(grid);

    UM.req('/api/mood?params=' + encodeURIComponent(moodParams))
      .then(function (data) {
        if (!active(token)) return;
        clearView(grid);
        var pls = (data && data.playlists) || [];
        if (!pls.length) {
          grid.appendChild(h('div', { className: 'um-empty' },
            h('div', { className: 'um-empty-title', text: 'Nothing here yet' })
          ));
          return;
        }
        for (var i = 0; i < pls.length; i++) {
          grid.appendChild(ui.card(pls[i], 'playlist'));
        }
      })
      .catch(function (err) {
        if (!active(token)) return;
        showError(container, err && err.message, function () { views.mood(container, params); });
      });
  };

  /* ==================================================================== *
   * VIEW: Library hub
   * ==================================================================== */
  views.library = function (container, params) {
    var token = beginView();
    clearView(container);
    setPageTint(null, token);
    params = params || {};

    if (params.id) {
      views.userPlaylist(container, params.id);
      return;
    }

    function newPlaylistFlow() {
      ui.prompt({ title: 'New playlist', placeholder: 'Playlist name', okText: 'Create' })
        .then(function (name) {
          if (!name) return;
          var pl = core.createPlaylist(name);
          if (pl) ui.nav('#/userpl/' + encodeURIComponent(pl.id));
        });
    }

    var head = h('div', { className: 'um-section' },
      h('h1', { className: 'um-section-title', style: 'font-size:32px;margin-bottom:14px;', text: 'Your Library' }),
      h('div', { className: 'um-hero-actions', style: 'margin:0 0 12px;' },
        h('button', {
          className: 'um-btn um-btn--accent',
          html: icon('plus'),
          children: [document.createTextNode(' Create playlist')],
          onClick: newPlaylistFlow
        })
      ),
      h('div', { className: 'um-search-tabs', style: 'padding-left:0;padding-right:0;' },
        h('button', { className: 'um-tab um-tab--active', text: 'Playlists' }),
        h('button', {
          className: 'um-tab',
          text: 'History',
          onClick: function () { ui.nav('#/history'); }
        }),
        h('button', {
          className: 'um-tab',
          text: 'Liked Songs',
          onClick: function () { ui.nav('#/liked'); }
        })
      )
    );
    container.appendChild(head);

    var grid = h('div', { className: 'um-grid' });
    container.appendChild(grid);

    var likedTracks = core.lib.liked || [];
    grid.appendChild(h('div', {
      className: 'um-card',
      onClick: function () { ui.nav('#/liked'); }
    },
      h('div', {
        className: 'um-card-artwrap',
        style: 'background:linear-gradient(135deg,#6FC3FF 0%,#1F6FE0 55%,#0B3C86 100%);display:grid;place-items:center;color:#fff;'
      },
        h('div', { style: 'width:44px;height:44px;', html: icon('heartFill') }),
        h('button', {
          className: 'um-card-play',
          html: icon('play'),
          title: 'Play',
          onClick: function (e) {
            e.stopPropagation();
            if (likedTracks.length) playTracks(likedTracks, 0, 'liked', false);
          }
        })
      ),
      h('div', { className: 'um-card-title', text: 'Liked Songs' }),
      h('div', { className: 'um-card-sub', text: likedTracks.length + ' songs' })
    ));

    var pls = core.lib.playlists || [];
    for (var i = 0; i < pls.length; i++) {
      (function (pl) {
        var trs = pl.tracks || [];
        var art = (trs[0] && (trs[0].art || trs[0].thumb)) || null;
        grid.appendChild(h('div', {
          className: 'um-card',
          onClick: function () { ui.nav('#/userpl/' + encodeURIComponent(pl.id)); }
        },
          h('div', { className: 'um-card-artwrap' },
            art ? ui.img(art, 'um-card-art') : h('div', { className: 'um-img-fallback', html: icon('note') }),
            h('button', {
              className: 'um-card-play',
              html: icon('play'),
              title: 'Play',
              onClick: function (e) {
                e.stopPropagation();
                if (trs.length) playTracks(trs, 0, 'userpl', false);
              }
            })
          ),
          h('div', { className: 'um-card-title', text: pl.name || 'Untitled' }),
          h('div', { className: 'um-card-sub', text: trs.length + ' songs' })
        ));
      })(pls[i]);
    }

    if (!pls.length) {
      var empty = h('div', { className: 'um-empty' },
        h('div', { className: 'um-empty-icon', html: icon('note') }),
        h('div', { className: 'um-empty-title', text: 'No playlists yet' }),
        h('div', { className: 'um-empty-text', text: 'Create one to collect your favorite songs.' }),
        h('button', {
          className: 'um-btn um-btn--accent um-mt16',
          text: 'Create playlist',
          onClick: newPlaylistFlow
        })
      );
      container.appendChild(empty);
    }
  };

  /* -------------------------------------------------- user playlist page */

  views.userPlaylist = function (container, plId) {
    var token = beginView();
    clearView(container);
    setPageTint(null, token);

    var pls = core.lib.playlists || [];
    var pl = null;
    for (var i = 0; i < pls.length; i++) {
      if (pls[i].id === plId) { pl = pls[i]; break; }
    }

    if (!pl) {
      showError(container, 'This playlist no longer exists.', function () { ui.nav('#/library'); });
      return;
    }

    var tracks = pl.tracks || [];
    var art = (tracks[0] && (tracks[0].art || tracks[0].thumb)) || null;
    setPageTint(art, token);

    var hero = h('div', { className: 'um-hero' },
      h('div', { className: 'um-hero-art' },
        art ? ui.img(art, '') : h('div', { className: 'um-img-fallback', html: icon('note') })
      ),
      h('div', { className: 'um-hero-info' },
        h('div', { className: 'um-hero-eyebrow', text: 'Playlist' }),
        h('h1', { className: 'um-hero-title', text: pl.name || 'Untitled' }),
        h('div', { className: 'um-hero-meta' },
          h('strong', { text: 'You' }),
          h('span', { className: 'um-dot', text: '•' }),
          h('span', { text: tracks.length + ' songs' })
        ),
        h('div', { className: 'um-hero-actions' },
          h('button', {
            className: 'um-btn um-btn--accent',
            html: icon('play'),
            children: [document.createTextNode(' Play')],
            onClick: function () { playTracks(tracks, 0, 'userpl', false); }
          }),
          h('button', {
            className: 'um-btn um-btn--ghost',
            html: icon('shuffle'),
            children: [document.createTextNode(' Shuffle')],
            onClick: function () {
              if (!tracks.length || !UM.player) return;
              UM.player.setShuffle(true);
              core.lib.settings.shuffle = true;
              scheduleLibrarySave();
              playTracks(tracks, 0, 'userpl', false);
            }
          }),
          h('button', {
            className: 'um-btn um-btn--ghost',
            text: 'Rename',
            onClick: function () {
              ui.prompt({ title: 'Rename playlist', value: pl.name }).then(function (nn) {
                if (nn) core.renamePlaylist(pl.id, nn);
                views.userPlaylist(container, pl.id);
              });
            }
          }),
          h('button', {
            className: 'um-btn um-btn--ghost',
            text: 'Delete',
            onClick: function () {
              ui.confirm({
                title: 'Delete playlist?',
                text: 'Are you sure you want to delete "' + (pl.name || '') + '"?',
                danger: true,
                okText: 'Delete'
              }).then(function (ok) {
                if (!ok) return;
                core.deletePlaylist(pl.id);
                ui.nav('#/library');
              });
            }
          })
        )
      )
    );
    container.appendChild(hero);

    if (!tracks.length) {
      container.appendChild(h('div', { className: 'um-empty' },
        h('div', { className: 'um-empty-icon', html: icon('note') }),
        h('div', { className: 'um-empty-title', text: 'Playlist is empty' }),
        h('div', { className: 'um-empty-text', text: 'Use the ⋯ menu on any track to add it here.' })
      ));
      return;
    }

    container.appendChild(listWithSource(tracks, {
      onRemove: function (idx) {
        tracks.splice(idx, 1);
        scheduleLibrarySave();
        views.userPlaylist(container, pl.id);
      },
      removeText: 'Remove from playlist',
      onPlayTrack: function (idx) { playTracks(tracks, idx, 'userpl', false); }
    }, 'userpl'));
  };

  /* ==================================================================== *
   * VIEW: Liked Songs
   * ==================================================================== */
  views.liked = function (container) {
    var token = beginView();
    clearView(container);
    setPageTint(null, token);

    var tracks = (core.lib.liked || []).slice();

    var hero = h('div', { className: 'um-hero' },
      h('div', {
        className: 'um-hero-art',
        style: 'background:linear-gradient(135deg,#6FC3FF 0%,#1F6FE0 55%,#0B3C86 100%);display:grid;place-items:center;color:#fff;'
      },
        h('div', { style: 'width:64px;height:64px;', html: icon('heartFill') })
      ),
      h('div', { className: 'um-hero-info' },
        h('div', { className: 'um-hero-eyebrow', text: 'Playlist' }),
        h('h1', { className: 'um-hero-title', text: 'Liked Songs' }),
        h('div', { className: 'um-hero-meta' },
          h('strong', { text: 'You' }),
          h('span', { className: 'um-dot', text: '•' }),
          h('span', { text: tracks.length + ' songs' })
        ),
        h('div', { className: 'um-hero-actions' },
          h('button', {
            className: 'um-btn um-btn--accent',
            html: icon('play'),
            children: [document.createTextNode(' Play')],
            onClick: function () { playTracks(tracks, 0, 'liked', false); }
          }),
          h('button', {
            className: 'um-btn um-btn--ghost',
            html: icon('shuffle'),
            children: [document.createTextNode(' Shuffle')],
            onClick: function () {
              if (!tracks.length || !UM.player) return;
              UM.player.setShuffle(true);
              core.lib.settings.shuffle = true;
              scheduleLibrarySave();
              playTracks(tracks, 0, 'liked', false);
            }
          })
        )
      )
    );
    container.appendChild(hero);

    if (!tracks.length) {
      container.appendChild(h('div', { className: 'um-empty' },
        h('div', { className: 'um-empty-icon', html: icon('heart') }),
        h('div', { className: 'um-empty-title', text: 'Songs you like will appear here' }),
        h('div', { className: 'um-empty-text', text: 'Save songs by tapping the heart icon.' })
      ));
      return;
    }

    container.appendChild(listWithSource(tracks, {
      onRemove: function (idx, tr) {
        core.toggleLike(tr);
        views.liked(container);
      },
      removeText: 'Remove from Liked',
      onPlayTrack: function (idx) { playTracks(tracks, idx, 'liked', false); }
    }, 'liked'));
  };

  /* ==================================================================== *
   * VIEW: History
   * ==================================================================== */
  views.history = function (container) {
    var token = beginView();
    clearView(container);
    setPageTint(null, token);

    var tracks = (core.lib.history || []).slice();

    var hero = h('div', { className: 'um-hero' },
      h('div', {
        className: 'um-hero-art',
        style: 'background:var(--surface-2);display:grid;place-items:center;color:var(--text-2);'
      },
        h('div', { style: 'width:64px;height:64px;', html: icon('note') })
      ),
      h('div', { className: 'um-hero-info' },
        h('div', { className: 'um-hero-eyebrow', text: 'History' }),
        h('h1', { className: 'um-hero-title', text: 'Listening History' }),
        h('div', { className: 'um-hero-meta' },
          h('span', { text: tracks.length + ' tracks played' })
        ),
        h('div', { className: 'um-hero-actions' },
          h('button', {
            className: 'um-btn um-btn--accent',
            html: icon('play'),
            children: [document.createTextNode(' Play')],
            onClick: function () { playTracks(tracks, 0, 'history', false); }
          }),
          h('button', {
            className: 'um-btn um-btn--ghost',
            text: 'Clear history',
            onClick: function () {
              ui.confirm({
                title: 'Clear history?',
                text: 'Are you sure you want to clear your listening history?',
                danger: true,
                okText: 'Clear'
              }).then(function (ok) {
                if (!ok) return;
                core.lib.history = [];
                core.emit('library', core.lib);
                scheduleLibrarySave();
                views.history(container);
              });
            }
          })
        )
      )
    );
    container.appendChild(hero);

    if (!tracks.length) {
      container.appendChild(h('div', { className: 'um-empty' },
        h('div', { className: 'um-empty-title', text: 'No history yet' }),
        h('div', { className: 'um-empty-text', text: 'Songs you play will show up here.' })
      ));
      return;
    }

    container.appendChild(listWithSource(tracks, {
      onRemove: function (idx, tr) {
        core.lib.history = (core.lib.history || []).filter(function (t) { return t.id !== tr.id; });
        core.emit('library', core.lib);
        scheduleLibrarySave();
        views.history(container);
      },
      removeText: 'Remove from history',
      onPlayTrack: function (idx) { playTracks(tracks, idx, 'history', false); }
    }, 'history'));
  };

  /* ==================================================================== *
   * VIEW: Settings
   * ==================================================================== */
  views.settings = function (container) {
    var token = beginView();
    clearView(container);
    setPageTint(null, token);

    var user = core.me() || {};
    var wrap = h('div', { className: 'um-section' },
      h('h1', { className: 'um-section-title', style: 'font-size:32px;margin-bottom:18px;', text: 'Settings' })
    );
    var stack = h('div', { className: 'um-settings' });

    /* ------------------------------------------------------- account */
    stack.appendChild(h('div', { className: 'um-settings-section' },
      h('div', { className: 'um-settings-title', text: 'Account' }),
      h('div', { className: 'um-settings-row' },
        h('div', { className: 'um-settings-user' },
          h('div', { className: 'um-user-avatar', text: (user.name || 'U').charAt(0).toUpperCase() }),
          h('div', { className: 'um-user-text' },
            h('div', { className: 'um-user-name', text: user.name || 'Anonymous' }),
            h('div', { className: 'um-user-meta', text: user.admin ? 'Administrator' : 'Standard member' })
          )
        ),
        h('button', {
          className: 'um-btn um-btn--ghost',
          text: 'Sign out',
          onClick: function () { core.logout(); }
        })
      )
    ));

    /* ------------------------------------------------------ playback */
    var playbackSec = h('div', { className: 'um-settings-section' },
      h('div', { className: 'um-settings-title', text: 'Playback' })
    );

    /* audio quality: pills (Data saver / Normal / High) */
    var QUALITY = [
      { v: 'low', label: 'Data saver', hint: ui.isIOS() ? '~48 kbps AAC' : '~50-70 kbps Opus' },
      { v: 'normal', label: 'Normal', hint: '128 kbps AAC' },
      { v: 'high', label: 'High', hint: ui.isIOS() ? '128 kbps (max on iPhone)' : '~160 kbps Opus' }
    ];
    var curQ = (core.lib.settings && core.lib.settings.quality) || 'normal';
    var qHint = h('span', { className: 'um-settings-hint', text: '' });
    var qPills = h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;' });
    function paintQuality() {
      qPills.innerHTML = '';
      QUALITY.forEach(function (opt) {
        qPills.appendChild(h('button', {
          className: 'um-pill' + (opt.v === curQ ? ' um-pill--active' : ''),
          text: opt.label,
          onClick: function () {
            curQ = opt.v;
            core.lib.settings.quality = opt.v;
            scheduleLibrarySave();
            paintQuality();
            ui.toast('Audio quality: ' + opt.label + ' (from the next song)');
          }
        }));
        if (opt.v === curQ) qHint.textContent = opt.hint + ' · applies from the next song';
      });
    }
    paintQuality();
    playbackSec.appendChild(h('div', { className: 'um-settings-row' },
      h('div', {},
        h('span', { className: 'um-settings-label', text: 'Audio quality' }),
        qHint
      ),
      qPills
    ));

    if (!ui.isIOS()) {
      var currentXfade = (UM.player && UM.player.state && UM.player.state.crossfade) || 0;
      var xfadeVal = h('span', { className: 'um-settings-value', text: currentXfade + 's' });
      var xR = h('input', {
        className: 'um-range um-range--sm',
        type: 'range',
        min: '0',
        max: '12',
        step: '1',
        value: String(currentXfade)
      });
      xR.style.setProperty('--um-fill', (currentXfade / 12 * 100) + '%');
      xR.addEventListener('input', function () {
        var val = parseInt(xR.value, 10) || 0;
        if (UM.player) UM.player.setCrossfade(val);
        core.lib.settings.crossfade = val;
        xfadeVal.textContent = val + 's';
        xR.style.setProperty('--um-fill', (val / 12 * 100) + '%');
        scheduleLibrarySave();
      });
      playbackSec.appendChild(h('div', { className: 'um-settings-row' },
        h('div', {},
          h('span', { className: 'um-settings-label', text: 'Crossfade' }),
          h('span', { className: 'um-settings-hint', text: 'Overlap tracks smoothly' })
        ),
        h('div', { style: 'display:flex;align-items:center;gap:12px;min-width:0;width:100%;max-width:220px;' },
          xR,
          xfadeVal
        )
      ));
    }

    /* server URL — 16px input (no iOS zoom), wrapping row, 44px target */
    var apiBaseInput = h('input', {
      className: 'um-login-input',
      type: 'url',
      placeholder: 'Default (same origin)',
      value: core.apiBase() || '',
      style: 'flex:1 1 160px;min-width:0;max-width:280px;'
    });
    playbackSec.appendChild(h('div', { className: 'um-settings-row' },
      h('div', { style: 'min-width:0;max-width:100%;' },
        h('span', { className: 'um-settings-label', text: 'Backend server URL' }),
        h('span', { className: 'um-settings-hint', text: 'Remote: https://<host>.ts.net' })
      ),
      h('div', {
        className: 'um-settings-actions',
        style: 'flex:0 1 auto;justify-content:flex-end;min-width:0;max-width:100%;'
      },
        apiBaseInput,
        h('button', {
          className: 'um-btn um-btn--ghost',
          style: 'min-height:44px;',
          text: 'Save',
          onClick: function () {
            core.setApiBase(apiBaseInput.value.trim());
            ui.toast('Server URL updated');
          }
        })
      )
    ));
    stack.appendChild(playbackSec);

    /* -------------------------------------------------- taste import */
    var importSec = h('div', { className: 'um-settings-section' },
      h('div', { className: 'um-settings-title', text: 'Taste import' }),
      h('p', { className: 'um-settings-sub', text: 'Import likes, history and weights from the UTSHOW Android app (taste.json).' })
    );

    var fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none;' });
    var importBtn = h('button', {
      className: 'um-btn um-btn--ghost',
      text: 'Import from phone…',
      onClick: function () { fileInput.click(); }
    });

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      importBtn.textContent = 'Importing…';
      var reader = new FileReader();
      reader.onload = function (e) {
        var parsed;
        try {
          parsed = JSON.parse(e.target.result);
        } catch (pe) {
          importBtn.textContent = 'Import from phone…';
          ui.toast('Invalid JSON file', 'error');
          return;
        }
        UM.req('/api/import-taste', { method: 'POST', body: parsed })
          .then(function (counts) {
            importBtn.textContent = 'Import from phone…';
            counts = counts || {};
            return core.loadLibrary().then(function () {
              ui.toast('Imported: ' + (counts.liked || 0) + ' likes, ' +
                (counts.history || 0) + ' history, ' + (counts.playlists || 0) + ' playlists');
            });
          })
          .catch(function (err) {
            importBtn.textContent = 'Import from phone…';
            ui.toast('Import failed: ' + ((err && err.message) || 'unknown error'), 'error');
          });
      };
      reader.readAsText(file);
    });

    importSec.appendChild(h('div', { className: 'um-settings-actions' }, fileInput, importBtn));
    stack.appendChild(importSec);

    /* ------------------------------------------------------ install */
    var installSec = h('div', { className: 'um-settings-section' },
      h('div', { className: 'um-settings-title', text: 'Install app' })
    );

    if (ui.isIOS()) {
      installSec.appendChild(h('div', { className: 'um-install-hint' },
        h('span', { html: icon('note') }),
        h('span', { text: 'Share → Add to Home Screen' })
      ));
    } else if (window.__umInstallPrompt) {
      installSec.appendChild(h('div', { className: 'um-settings-actions' },
        h('button', {
          className: 'um-btn um-btn--accent',
          text: 'Install app',
          onClick: function () {
            var p = window.__umInstallPrompt;
            try { p.prompt(); } catch (e) {}
            if (p.userChoice && p.userChoice.then) {
              p.userChoice.then(function () {
                window.__umInstallPrompt = null;
                views.settings(container);
              });
            } else {
              window.__umInstallPrompt = null;
              views.settings(container);
            }
          }
        })
      ));
    } else {
      installSec.appendChild(h('p', { className: 'um-settings-sub', text: 'Already installed, or use your browser menu → Install app.' }));
    }
    stack.appendChild(installSec);

    /* ---------------------------------------------- recommender stats */
    stack.appendChild(h('div', { className: 'um-settings-section' },
      h('div', { className: 'um-settings-title', text: 'Recommender' }),
      h('p', { className: 'um-settings-sub', text: 'Inspect model weights, skip rates and learning metrics.' }),
      h('div', { className: 'um-settings-actions' },
        h('button', {
          className: 'um-btn um-btn--ghost',
          text: 'Recommender stats',
          onClick: function () { ui.nav('#/stats'); }
        })
      )
    ));

    /* -------------------------------------------------------- admin */
    if (user.admin) {
      var adminSec = h('div', { className: 'um-settings-section' },
        h('div', { className: 'um-settings-title', text: 'Admin' }),
        h('p', { className: 'um-settings-sub', text: 'Invite people and manage accounts.' })
      );

      var inviteCodeValue = '';
      var inviteCodeSlot = h('div', {
        className: 'um-invite-code',
        style: 'user-select:text;-webkit-user-select:text;',
        text: 'No code yet'
      });
      var inviteLinkLine = h('div', { className: 'um-invite-link', text: '' });

      var copyBtn = h('button', {
        className: 'um-btn um-btn--ghost',
        text: 'Copy code',
        onClick: function () {
          if (!inviteCodeValue) {
            ui.toast('Generate a code first');
            return;
          }
          copyText(inviteCodeValue);
        }
      });

      var genInviteBtn = h('button', {
        className: 'um-btn um-btn--accent',
        text: 'Invite someone',
        onClick: function () {
          UM.req('/api/invites', { method: 'POST' }).then(function (res) {
            if (!res || !res.code) {
              ui.toast('No code returned', 'error');
              return;
            }
            inviteCodeValue = res.code;
            inviteCodeSlot.textContent = res.code;
            var base = window.location.origin + window.location.pathname;
            inviteLinkLine.textContent = base + '#/register?invite=' + encodeURIComponent(res.code);
            ui.toast('Invite code generated');
          }).catch(function (err) {
            ui.toast('Failed to create invite: ' + ((err && err.message) || 'error'), 'error');
          });
        }
      });

      adminSec.appendChild(h('div', { className: 'um-invite um-mt16' },
        inviteCodeSlot,
        inviteLinkLine,
        h('div', { className: 'um-invite-actions' }, genInviteBtn, copyBtn)
      ));

      var usersList = h('div', { className: 'um-users um-mt16' });
      usersList.appendChild(h('div', { className: 'um-skel um-skel-line um-skel-line--md' }));
      adminSec.appendChild(usersList);

      UM.req('/api/users').then(function (res) {
        if (!active(token)) return;
        var uList = (res && res.users) || [];
        clearView(usersList);
        if (!uList.length) {
          usersList.appendChild(h('div', { className: 'um-stats-empty', text: 'No users yet' }));
          return;
        }
        for (var u = 0; u < uList.length; u++) {
          (function (usr) {
            var metaBits = [];
            if (usr.created) metaBits.push('Joined ' + usr.created);
            metaBits.push('Plays: ' + (usr.plays || 0));
            if (usr.lastSeen) metaBits.push('Last seen ' + usr.lastSeen);

            var row = h('div', { className: 'um-user-row' },
              h('div', { className: 'um-user-avatar', text: (usr.name || 'U').charAt(0).toUpperCase() }),
              h('div', { className: 'um-user-text' },
                h('div', { className: 'um-user-name', text: usr.name || 'Unknown' }),
                h('div', { className: 'um-user-meta', text: metaBits.join(' • ') })
              )
            );
            if (usr.admin) {
              row.appendChild(h('span', { className: 'um-badge', text: 'Admin' }));
            } else {
              row.appendChild(h('button', {
                className: 'um-icon-btn',
                html: icon('trash'),
                title: 'Delete user',
                onClick: function () {
                  ui.confirm({
                    title: 'Delete user?',
                    text: 'Remove "' + (usr.name || '') + '" and their data?',
                    danger: true,
                    okText: 'Delete'
                  }).then(function (ok) {
                    if (!ok) return;
                    UM.req('/api/users/' + encodeURIComponent(usr.id), { method: 'DELETE' })
                      .then(function () {
                        ui.toast('User removed');
                        views.settings(container);
                      })
                      .catch(function (e) {
                        ui.toast('Delete failed: ' + ((e && e.message) || 'error'), 'error');
                      });
                  });
                }
              }));
            }
            usersList.appendChild(row);
          })(uList[u]);
        }
      }).catch(function () {
        if (!active(token)) return;
        clearView(usersList);
        usersList.appendChild(h('div', { className: 'um-stats-empty', text: 'Could not load users' }));
      });

      stack.appendChild(adminSec);
    }

    wrap.appendChild(stack);
    container.appendChild(wrap);
  };

  /* ==================================================================== *
   * VIEW: Recommender stats
   * ==================================================================== */
  views.stats = function (container) {
    var token = beginView();
    clearView(container);
    setPageTint(null, token);

    var me = core.me() || {};
    var wrap = h('div', { className: 'um-section' },
      h('h1', { className: 'um-section-title', style: 'font-size:32px;margin-bottom:18px;', text: 'Recommender stats' })
    );
    var statsBox = h('div', { className: 'um-stats' });
    statsBox.appendChild(h('div', { className: 'um-skel um-skel-line um-skel-line--md' }));
    wrap.appendChild(statsBox);
    container.appendChild(wrap);

    UM.req('/api/stats').then(function (data) {
      if (!active(token)) return;
      clearView(statsBox);
      data = data || {};

      var modelBlock = data.model || {};
      var ranker = modelBlock.weights ? modelBlock : (data.ranker || {});
      var weights = ranker.weights || [];
      var prior = ranker.prior || [];
      var names = ranker.names || [];
      var updates = ranker.updates != null ? ranker.updates : 0;
      var history = ranker.history || modelBlock.history || [];
      var offline = data.offline || {};

      var skip7 = (data.skipRate7d != null) ? (data.skipRate7d * 100).toFixed(1) + '%' : '—';
      var skip30 = (data.skipRate30d != null) ? (data.skipRate30d * 100).toFixed(1) + '%' : '—';

      statsBox.appendChild(h('div', { className: 'um-stats-grid' },
        h('div', { className: 'um-stats-card' },
          h('div', { className: 'um-stats-card-val', text: String(data.events || 0) }),
          h('div', { className: 'um-stats-card-lbl', text: 'Your events' })
        ),
        h('div', { className: 'um-stats-card' },
          h('div', { className: 'um-stats-card-val', text: skip7 }),
          h('div', { className: 'um-stats-card-lbl', text: 'Skip rate 7d' })
        ),
        h('div', { className: 'um-stats-card' },
          h('div', { className: 'um-stats-card-val', text: skip30 }),
          h('div', { className: 'um-stats-card-lbl', text: 'Skip rate 30d' })
        ),
        h('div', { className: 'um-stats-card' },
          h('div', { className: 'um-stats-card-val', text: (offline.auc != null ? offline.auc.toFixed(3) : '—') }),
          h('div', { className: 'um-stats-card-lbl', text: 'Offline AUC' + (offline.n != null ? ' (n=' + offline.n + ')' : '') })
        ),
        h('div', { className: 'um-stats-card' },
          h('div', { className: 'um-stats-card-val', text: String(updates) }),
          h('div', { className: 'um-stats-card-lbl', text: 'Central model updates' })
        )
      ));

      /* skip rate by day chart */
      var days = data.skipRateByDay || [];
      if (days.length) {
        var chartWrap = h('div', { className: 'um-stats-chart-wrap um-mt16' },
          h('div', { className: 'um-settings-title', text: 'Daily skip rate' })
        );
        var chartBox = h('div', { className: 'um-stats-chart' });
        var W = 600;
        var H = 140;
        var pad = 20;
        var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
        svg.appendChild(svgEl('line', {
          x1: pad, y1: H - pad, x2: W - pad, y2: H - pad,
          stroke: 'rgba(255,255,255,0.12)', 'stroke-width': 1
        }));
        var pts = [];
        var dots = [];
        for (var i = 0; i < days.length; i++) {
          var rate = days[i] && days[i].rate != null ? days[i].rate : 0;
          if (rate < 0) rate = 0;
          if (rate > 1) rate = 1;
          var x = pad + (i / Math.max(1, days.length - 1)) * (W - pad * 2);
          var y = (H - pad) - rate * (H - pad * 2);
          pts.push(x.toFixed(1) + ',' + y.toFixed(1));
          dots.push({ x: x, y: y });
        }
        svg.appendChild(svgEl('polyline', {
          fill: 'none',
          stroke: '#4AA8FF',
          'stroke-width': 2.5,
          'stroke-linejoin': 'round',
          points: pts.join(' ')
        }));
        for (var d = 0; d < dots.length; d++) {
          svg.appendChild(svgEl('circle', {
            cx: dots[d].x.toFixed(1),
            cy: dots[d].y.toFixed(1),
            r: 3,
            fill: '#FFFFFF'
          }));
        }
        chartBox.appendChild(svg);
        chartWrap.appendChild(chartBox);
        chartWrap.appendChild(h('div', { className: 'um-stats-chart-label', text: 'Lower is better' }));
        statsBox.appendChild(chartWrap);
      }

      /* weight bars */
      if (weights.length) {
        var weightsSec = h('div', { className: 'um-mt16' },
          h('div', { className: 'um-settings-title', style: 'margin-bottom:12px;', text: 'Model weights (prior vs now)' })
        );
        var weightsList = h('div', { className: 'um-stats-weights' });
        for (var w = 0; w < weights.length; w++) {
          var wVal = Number(weights[w]) || 0;
          var pVal = Number(prior[w]) || 0;
          var normVal = Math.max(0, Math.min(1, (wVal + 3) / 6));
          var priorNorm = Math.max(0, Math.min(1, (pVal + 3) / 6));
          weightsList.appendChild(h('div', { className: 'um-stats-weight-row' },
            h('span', { className: 'um-stats-weight-name', text: names[w] || ('Feature #' + w) }),
            h('div', { className: 'um-stats-bar-track' },
              h('div', { className: 'um-stats-bar-fill', style: 'width:' + (normVal * 100).toFixed(1) + '%;' }),
              h('div', { className: 'um-stats-bar-prior', style: 'left:' + (priorNorm * 100).toFixed(1) + '%;' })
            ),
            h('span', { className: 'um-stats-weight-val', text: wVal.toFixed(2) })
          ));
        }
        weightsSec.appendChild(weightsList);
        statsBox.appendChild(weightsSec);
      } else {
        statsBox.appendChild(h('div', { className: 'um-stats-empty um-mt16', text: 'No model weights yet — play a few recommended tracks.' }));
      }

      /* central model snapshots */
      if (history.length) {
        var histSec = h('div', { className: 'um-mt16' },
          h('div', { className: 'um-settings-title', style: 'margin-bottom:8px;', text: 'Central model snapshots' })
        );
        var histList = h('div', { className: 'um-stats-list' });
        var shown = 0;
        for (var hi = history.length - 1; hi >= 0 && shown < 20; hi--, shown++) {
          var snap = history[hi] || {};
          var ts = snap.ts;
          var tsText = '—';
          if (ts != null) {
            var dObj = new Date(ts);
            if (!isNaN(dObj.getTime())) tsText = dObj.toLocaleString();
            else tsText = String(ts);
          }
          histList.appendChild(h('div', { className: 'um-stats-listrow' },
            h('span', { text: tsText }),
            h('span', { text: (snap.updates || 0) + ' updates' })
          ));
        }
        histSec.appendChild(histList);
        statsBox.appendChild(histSec);
      }

      /* admin per-user stats */
      var perUser = data.users || data.perUser || [];
      if (me.admin && perUser.length) {
        var userSec = h('div', { className: 'um-mt16' },
          h('div', { className: 'um-settings-title', style: 'margin-bottom:8px;', text: 'Everyone' })
        );
        var userList = h('div', { className: 'um-stats-list' });
        for (var pu = 0; pu < perUser.length; pu++) {
          var urow = perUser[pu] || {};
          var bits = [];
          bits.push((urow.plays || 0) + ' plays');
          if (urow.skipRate != null) bits.push((urow.skipRate * 100).toFixed(1) + '% skip');
          else if (urow.skipRate7d != null) bits.push((urow.skipRate7d * 100).toFixed(1) + '% skip');
          userList.appendChild(h('div', { className: 'um-stats-listrow' },
            h('span', { text: urow.name || 'Unknown' }),
            h('span', { text: bits.join(' • ') })
          ));
        }
        userSec.appendChild(userList);
        statsBox.appendChild(userSec);
      }

      /* top artists */
      var topArtists = data.topArtists || [];
      if (topArtists.length) {
        var artSec = h('div', { className: 'um-mt16' },
          h('div', { className: 'um-settings-title', style: 'margin-bottom:8px;', text: 'Your top artists' })
        );
        var artList = h('div', { className: 'um-stats-list' });
        for (var a = 0; a < topArtists.length; a++) {
          artList.appendChild(h('div', { className: 'um-stats-listrow' },
            h('span', { text: topArtists[a].name || 'Unknown' }),
            h('span', { text: (topArtists[a].plays || 0) + ' plays' })
          ));
        }
        artSec.appendChild(artList);
        statsBox.appendChild(artSec);
      }
    }).catch(function (err) {
      if (!active(token)) return;
      clearView(statsBox);
      statsBox.appendChild(h('div', { className: 'um-empty' },
        h('div', { className: 'um-empty-title', text: 'Failed to load stats' }),
        h('div', { className: 'um-empty-text', text: (err && err.message) || 'Please try again.' }),
        h('button', {
          className: 'um-btn um-btn--accent um-mt16',
          text: 'Retry',
          onClick: function () { views.stats(container); }
        })
      ));
    });
  };

  /* ==================================================================== *
   * VIEW: Login
   * ==================================================================== */
  views.login = function (container) {
    beginView();
    clearView(container);
    setPageTint(null, viewToken);

    var scrim = h('div', { className: 'um-login-scrim' });
    var card = h('div', { className: 'um-login-card' },
      h('div', { className: 'um-login-logo', html: icon('note') }),
      h('h2', { className: 'um-login-title', text: 'UTSHOW Music' }),
      h('p', { className: 'um-login-sub', text: 'Sign in to your personal music library.' })
    );

    var nameInput = h('input', {
      className: 'um-login-input',
      type: 'text',
      placeholder: 'ish',
      autocomplete: 'username'
    });
    var passInput = h('input', {
      className: 'um-login-input',
      type: 'password',
      placeholder: 'Passphrase',
      autocomplete: 'current-password'
    });
    var serverInput = h('input', {
      className: 'um-login-input',
      type: 'url',
      placeholder: 'https://<host>.ts.net (optional)',
      value: core.apiBase() || '',
      autocomplete: 'url'
    });
    var errDiv = h('div', { className: 'um-login-error', text: '' });
    var submitBtn = h('button', { className: 'um-login-btn', type: 'submit', text: 'Sign in' });

    var form = h('form', {
      className: 'um-login-form',
      onSubmit: function (e) {
        e.preventDefault();
        errDiv.textContent = '';
        var n = nameInput.value.trim();
        var p = passInput.value;
        if (!n) { errDiv.textContent = 'Enter your name'; nameInput.focus(); return; }
        if (!p) { errDiv.textContent = 'Enter your passphrase'; passInput.focus(); return; }

        core.setApiBase(serverInput.value.trim());

        submitBtn.textContent = 'Signing in…';
        submitBtn.disabled = true;
        core.login(n, p).then(function () {
          ui.nav('#/home');
        }).catch(function (err) {
          submitBtn.textContent = 'Sign in';
          submitBtn.disabled = false;
          errDiv.textContent = (err && err.message) || 'Sign in failed';
        });
      }
    });

    form.appendChild(h('div', { className: 'um-login-field' },
      h('label', { className: 'um-login-label', text: 'Username' }),
      nameInput
    ));
    form.appendChild(h('div', { className: 'um-login-field' },
      h('label', { className: 'um-login-label', text: 'Passphrase' }),
      passInput
    ));
    form.appendChild(h('div', { className: 'um-login-field' },
      h('label', { className: 'um-login-label', text: 'Server URL' }),
      serverInput
    ));
    form.appendChild(errDiv);
    form.appendChild(submitBtn);

    card.appendChild(form);
    card.appendChild(h('div', { className: 'um-login-switch' },
      document.createTextNode('Have an invite? '),
      h('a', { className: 'um-link', href: '#/register', text: 'Create account' })
    ));
    card.appendChild(h('p', { className: 'um-login-note', text: 'Server URL is only needed when this page is hosted remotely.' }));

    scrim.appendChild(card);
    container.appendChild(scrim);

    setTimeout(function () {
      try { nameInput.focus(); } catch (e) {}
    }, 50);
  };

  /* ==================================================================== *
   * VIEW: Register
   * ==================================================================== */
  views.register = function (container, params) {
    beginView();
    clearView(container);
    setPageTint(null, viewToken);

    params = params || {};
    var prefilledInvite = params.invite || '';

    var scrim = h('div', { className: 'um-login-scrim' });
    var card = h('div', { className: 'um-login-card' },
      h('div', { className: 'um-login-logo', html: icon('note') }),
      h('h2', { className: 'um-login-title', text: 'Join UTSHOW' }),
      h('p', { className: 'um-login-sub', text: 'Redeem an invite code to create your account.' })
    );

    var inviteInput = h('input', {
      className: 'um-login-input',
      type: 'text',
      placeholder: 'INVITE-CODE',
      value: prefilledInvite
    });
    var nameInput = h('input', {
      className: 'um-login-input',
      type: 'text',
      placeholder: 'Username',
      autocomplete: 'username'
    });
    var passInput = h('input', {
      className: 'um-login-input',
      type: 'password',
      placeholder: 'Passphrase',
      autocomplete: 'new-password'
    });
    var serverInput = h('input', {
      className: 'um-login-input',
      type: 'url',
      placeholder: 'https://<host>.ts.net (optional)',
      value: core.apiBase() || '',
      autocomplete: 'url'
    });
    var errDiv = h('div', { className: 'um-login-error', text: '' });
    var submitBtn = h('button', { className: 'um-login-btn', type: 'submit', text: 'Create account' });

    var form = h('form', {
      className: 'um-login-form',
      onSubmit: function (e) {
        e.preventDefault();
        errDiv.textContent = '';
        var inv = inviteInput.value.trim();
        var n = nameInput.value.trim();
        var p = passInput.value;
        if (!inv) { errDiv.textContent = 'Enter your invite code'; inviteInput.focus(); return; }
        if (!n) { errDiv.textContent = 'Choose a username'; nameInput.focus(); return; }
        if (!p) { errDiv.textContent = 'Choose a passphrase'; passInput.focus(); return; }

        core.setApiBase(serverInput.value.trim());

        submitBtn.textContent = 'Creating account…';
        submitBtn.disabled = true;
        core.register(inv, n, p).then(function () {
          ui.nav('#/home');
        }).catch(function (err) {
          submitBtn.textContent = 'Create account';
          submitBtn.disabled = false;
          errDiv.textContent = (err && err.message) || 'Registration failed';
        });
      }
    });

    form.appendChild(h('div', { className: 'um-login-field' },
      h('label', { className: 'um-login-label', text: 'Invite code' }),
      inviteInput
    ));
    form.appendChild(h('div', { className: 'um-login-field' },
      h('label', { className: 'um-login-label', text: 'Username' }),
      nameInput
    ));
    form.appendChild(h('div', { className: 'um-login-field' },
      h('label', { className: 'um-login-label', text: 'Passphrase' }),
      passInput
    ));
    form.appendChild(h('div', { className: 'um-login-field' },
      h('label', { className: 'um-login-label', text: 'Server URL' }),
      serverInput
    ));
    form.appendChild(errDiv);
    form.appendChild(submitBtn);

    card.appendChild(form);
    card.appendChild(h('div', { className: 'um-login-switch' },
      document.createTextNode('Already have an account? '),
      h('a', { className: 'um-link', href: '#/login', text: 'Sign in' })
    ));

    scrim.appendChild(card);
    container.appendChild(scrim);

    setTimeout(function () {
      try {
        if (prefilledInvite) nameInput.focus();
        else inviteInput.focus();
      } catch (e) {}
    }, 50);
  };

  /* Export module */
  UM.views = views;
})();
