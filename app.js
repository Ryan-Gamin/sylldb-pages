/**
 * Spotify Pro Lyrics Studio & TTML Manager
 * Modern client-side controller
 */

const CLOUD_API_ORIGIN = 'https://sylldb.ajob.workers.dev';
const IS_LOCAL_HOST = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const IS_WORKER_HOST = window.location.hostname.endsWith('.workers.dev');

// Automatically route relative /api/* requests and /api/export/* opens to the Cloudflare D1 Worker when hosted on custom domains (e.g. sylldb.env.pm)
const _nativeFetch = window.fetch.bind(window);
window.fetch = function(input, init) {
  if (typeof input === 'string' && input.startsWith('/api/') && !IS_LOCAL_HOST && !IS_WORKER_HOST) {
    input = CLOUD_API_ORIGIN + input;
  }
  return _nativeFetch(input, init);
};

const _nativeOpen = window.open.bind(window);
window.open = function(url, target, features) {
  if (typeof url === 'string' && url.startsWith('/api/') && !IS_LOCAL_HOST && !IS_WORKER_HOST) {
    url = CLOUD_API_ORIGIN + url;
  }
  return _nativeOpen(url, target, features);
};

const state = {
  currentStep: 1,
  selectedSong: null,
  parsedLyrics: null,
  rawContent: '',
  detectedFormat: '',
  sourceFormat: '',
  isAlignmenter: false,
  isPlaying: false,
  virtualTime: 0,
  virtualTimer: null,
  managerSongs: [],
  audioMode: 'html5',
  manualLyricType: 'auto',
  ytPlayer: null,
  ytReady: false,
  ytVideoId: null,
  pendingYtVideoId: null,
  ytAntiAdLocked: false,
  ytSyncTimer: null
};

// Lyric Type Helpers
function getTypeBadgeColor(type) {
  if (!type) return '';
  const t = String(type).toLowerCase();
  if (t.includes('syllab')) return 'green';
  if (t.includes('word')) return 'cyan';
  if (t.includes('line')) return 'purple';
  if (t.includes('static')) return 'gray';
  return '';
}

function getTypeIcon(type) {
  if (!type) return '🎵';
  const t = String(type).toLowerCase();
  if (t.includes('syllab')) return '🔥';
  if (t.includes('word')) return '⚡';
  if (t.includes('line')) return '📄';
  if (t.includes('static')) return '📝';
  return '🎵';
}

function setManualLyricType(type) {
  state.manualLyricType = type;
  document.querySelectorAll('#manual-type-selector .type-pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });

  const badge = document.getElementById('badge-detected-type');
  if (badge) {
    if (type === 'auto') {
      badge.textContent = state.parsedLyrics?.Type ? `Detected: ${state.parsedLyrics.Type}` : '✨ Auto-Detect';
      badge.className = `pill-badge ${getTypeBadgeColor(state.parsedLyrics?.Type)}`;
    } else {
      badge.textContent = `Selected: ${type}`;
      badge.className = `pill-badge ${getTypeBadgeColor(type)}`;
    }
  }

  if (state.parsedLyrics && type !== 'auto') {
    state.parsedLyrics.Type = type;
  }
}

// DOM Elements
const audioEngine = document.getElementById('audio-engine');
const searchInput = document.getElementById('song-search-input');
const searchSpinner = document.getElementById('search-spinner');
const searchResults = document.getElementById('search-results');
const selectedBanner = document.getElementById('selected-song-banner');
const audioScrubber = document.getElementById('audio-scrubber');
const btnPlayPause = document.getElementById('btn-play-pause');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const karaokeStage = document.getElementById('karaoke-stage');

// ----------------------------------------------------
// Initialization
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initSearch();
  initDropzone();
  initAudioEngine();
  checkServerStatus();
  setInterval(checkServerStatus, 10000);
  loadManagerSongs();

  if (selectedBanner) selectedBanner.style.display = 'none';

  const toggleAlignmenter = document.getElementById('toggle-alignmenter');
  if (toggleAlignmenter) {
    toggleAlignmenter.addEventListener('change', () => {
      state.isAlignmenter = toggleAlignmenter.checked;
    });
  }
});

function formatDbSizeSubtext(totalBytes) {
  const bytes = Number(totalBytes) || 0;
  const fiveGbBytes = 5 * 1024 * 1024 * 1024;
  if (bytes >= fiveGbBytes) {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
  } else {
    const mb = bytes / (1024 * 1024);
    return `${mb < 1 && mb > 0 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
  }
}

// Server status
async function checkServerStatus() {
  const txt = document.getElementById('server-status-text');
  const sub = document.getElementById('server-status-subtext');
  const bar = document.getElementById('server-storage-bar-fill');
  const dot = document.getElementById('server-status-dot');
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      const data = await res.json();
      const tracks = Number(data.totalTracks) || 0;
      const maxTracks = Number(data.maxTracks) || 250000;
      const bytes = Number(data.totalBytes) || 0;
      const maxBytes = Number(data.maxBytes) || (10 * 1024 * 1024 * 1024);

      if (txt) {
        txt.textContent = `${tracks.toLocaleString()}/250K songs stored`;
      }
      if (sub) {
        sub.textContent = `${formatDbSizeSubtext(bytes)} / 10 GB`;
      }
      if (bar) {
        const pct = Math.max(tracks > 0 ? 0.8 : 0, Math.min(100, Math.max((tracks / maxTracks) * 100, (bytes / maxBytes) * 100)));
        bar.style.width = `${pct}%`;
      }
      if (dot) {
        dot.style.background = 'var(--spotify-green)';
        dot.style.boxShadow = '0 0 10px var(--spotify-green)';
      }
    } else {
      if (txt) txt.textContent = 'SyllDB Degraded';
      if (sub) sub.textContent = 'Check server status';
    }
  } catch {
    if (txt) txt.textContent = 'SyllDB Offline';
    if (sub) sub.textContent = 'Reconnecting...';
    if (dot) {
      dot.style.background = '#ef4444';
      dot.style.boxShadow = '0 0 10px #ef4444';
    }
  }
}

// ----------------------------------------------------
// Tabs Navigation
// ----------------------------------------------------
function initTabs() {
  const tabBtns = document.querySelectorAll('.nav-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;
      tabBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      document.getElementById(targetId)?.classList.add('active');

      if (targetId === 'tab-manager') {
        loadManagerSongs();
      }
    });
  });
}

function switchTab(tabId) {
  const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
  if (btn) btn.click();
}

// ----------------------------------------------------
// Stepper Wizard (Steps 1 to 4)
// ----------------------------------------------------
function goToStep(stepNumber) {
  if (stepNumber === 2 && !state.selectedSong) {
    alert('Please choose or enter a song first in Step 1.');
    return;
  }
  if (stepNumber >= 3 && !state.parsedLyrics) {
    alert('Please upload or parse lyrics first in Step 2.');
    return;
  }

  state.currentStep = stepNumber;

  // Update indicators
  for (let i = 1; i <= 4; i++) {
    const indicator = document.getElementById(`step-indicator-${i}`);
    const panel = document.getElementById(`step-panel-${i}`);
    if (indicator) {
      indicator.classList.remove('active', 'completed');
      if (i === stepNumber) {
        indicator.classList.add('active');
      } else if (i < stepNumber) {
        indicator.classList.add('completed');
      }
    }
    if (panel) {
      panel.style.display = (i === stepNumber) ? 'block' : 'none';
    }
  }

  if (stepNumber === 3) {
    renderKaraokePreview();
    if (state.selectedSong) {
      autoLoadYouTubeAudioForPreview(state.selectedSong);
    }
  } else if (stepNumber === 4) {
    preparePublishSummary();
  }
}

// ----------------------------------------------------
function extractSpotifyTrackId(input) {
  if (!input) return null;
  const str = input.trim();
  const urlMatch = str.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]{22})/);
  if (urlMatch) return urlMatch[1];
  const uriMatch = str.match(/spotify:track:([a-zA-Z0-9]{22})/);
  if (uriMatch) return uriMatch[1];
  if (/^[a-zA-Z0-9]{22}$/.test(str)) return str;
  return null;
}

// ----------------------------------------------------
// Step 1: Song Search (Spotify Link + Deezer + iTunes)
// ----------------------------------------------------
let searchDebounceTimer = null;

function initSearch() {
  const handleSearchInput = () => {
    clearTimeout(searchDebounceTimer);
    const query = searchInput.value.trim();
    if (!query) {
      searchResults.innerHTML = '';
      searchSpinner.style.display = 'none';
      return;
    }

    // Instant Spotify Link / URI / ID Detection
    const spotifyId = extractSpotifyTrackId(query);
    if (spotifyId) {
      searchSpinner.style.display = 'block';
      searchResults.innerHTML = `
        <div style="color: var(--primary); grid-column: 1/-1; text-align: center; padding: 1.5rem; background: rgba(30,215,96,0.06); border: 1px solid rgba(30,215,96,0.2); border-radius: 12px;">
          <span class="spinner" style="display:inline-block; margin-right:8px; vertical-align:middle;"></span>
          <strong>Detected Spotify Track Link!</strong> Fetching metadata for ID: <code>${spotifyId}</code>...
        </div>`;
      executeSpotifyLookup(spotifyId);
      return;
    }

    searchSpinner.style.display = 'block';
    searchDebounceTimer = setTimeout(() => executeSearch(query), 350);
  };

  searchInput.addEventListener('input', handleSearchInput);
  searchInput.addEventListener('paste', () => setTimeout(handleSearchInput, 50));

  // Live Track ID / Identifier input listener
  const spotifyInput = document.getElementById('input-spotify-id');
  if (spotifyInput) {
    const handleIdInput = () => {
      const val = spotifyInput.value.trim();
      const cleanId = extractSpotifyTrackId(val);
      if (cleanId) {
        if (cleanId !== val && (val.includes('open.spotify.com') || val.includes('spotify:track:'))) {
          spotifyInput.value = cleanId;
        }
        updateSpotifyLiveEmbed(cleanId);

        // If no song is selected or track ID changed, resolve metadata from Spotify
        if (!state.selectedSong || state.selectedSong.spotifyTrackId !== cleanId) {
          fetch(`/api/spotify-track?id=${encodeURIComponent(cleanId)}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
              if (d && d.success && d.track) {
                state.selectedSong = d.track;
                document.getElementById('banner-art').src = d.track.artworkUrl || '';
                document.getElementById('banner-title').textContent = d.track.trackTitle;
                document.getElementById('banner-artist').textContent = `${d.track.artistName} • ${d.track.albumName || 'Single'}`;
                document.getElementById('banner-duration').textContent = formatDuration(d.track.durationSec);
                document.getElementById('banner-itunes-id').textContent = `Spotify ID: ${cleanId}`;
                document.getElementById('banner-preview-status').textContent = d.track.previewUrl ? 'Audio Preview Ready' : 'Synthesized Timing';
                selectedBanner.style.display = 'flex';
                if (d.track.previewUrl) {
                  audioEngine.src = d.track.previewUrl;
                  audioEngine.load();
                } else {
                  audioEngine.removeAttribute('src');
                }
              }
            })
            .catch(() => {});
        }
      } else {
        updateSpotifyLiveEmbed(null);
      }
    };

    spotifyInput.addEventListener('input', handleIdInput);
    spotifyInput.addEventListener('paste', () => setTimeout(handleIdInput, 50));
  }
}

async function executeSpotifyLookup(spotifyId) {
  try {
    const res = await fetch(`/api/spotify-track?id=${encodeURIComponent(spotifyId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && data.track) {
        searchSpinner.style.display = 'none';
        renderSearchResults([data.track]);
        selectSongByIndex(0);
        return;
      }
    }
  } catch (err) {
    console.warn('Direct spotify-track endpoint failed:', err);
  }

  // If direct API failed, pass to search
  executeSearch(spotifyId);
}

async function executeSearch(query) {
  searchSpinner.style.display = 'block';

  // 1. Try our backend search API (handles Spotify, Deezer, and iTunes proxy)
  try {
    const res = await fetch(`/api/search-external?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        searchSpinner.style.display = 'none';
        renderSearchResults(data.results);
        return;
      }
    }
  } catch (err) {
    console.warn('Backend search API failed, falling back to direct client search:', err);
  }

  // 2. Direct client-side iTunes fallback (runs directly from user browser with CORS)
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=15`;
    const itunesRes = await fetch(itunesUrl);
    if (itunesRes.ok) {
      const itunesData = await itunesRes.json();
      if (itunesData.results && itunesData.results.length > 0) {
        const formatted = itunesData.results.map(item => ({
          spotifyTrackId: '',
          itunesId: item.trackId,
          trackTitle: item.trackName || '',
          artistName: item.artistName || '',
          albumName: item.collectionName || '',
          durationSec: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : 0,
          artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : '',
          previewUrl: item.previewUrl || '',
          source: 'iTunes'
        }));
        searchSpinner.style.display = 'none';
        renderSearchResults(formatted);
        return;
      }
    }
  } catch (err) {
    console.warn('Client-side iTunes fallback failed:', err);
  }

  // 3. Direct client-side Deezer fallback via JSONP
  try {
    const deezerResults = await searchDeezerJsonp(query);
    if (deezerResults && deezerResults.length > 0) {
      searchSpinner.style.display = 'none';
      renderSearchResults(deezerResults);
      return;
    }
  } catch (err) {
    console.warn('Client-side Deezer fallback failed:', err);
  }

  searchSpinner.style.display = 'none';
  renderSearchResults([]);
}

function searchDeezerJsonp(query) {
  return new Promise((resolve) => {
    const cbName = 'deezer_cb_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const script = document.createElement('script');
    const cleanup = () => {
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve([]);
    }, 3500);

    window[cbName] = (data) => {
      clearTimeout(timer);
      cleanup();
      if (data && Array.isArray(data.data)) {
        const mapped = data.data.map(item => ({
          spotifyTrackId: '',
          trackTitle: item.title || item.title_short || '',
          artistName: item.artist ? item.artist.name : '',
          albumName: item.album ? item.album.title : '',
          durationSec: item.duration || 0,
          artworkUrl: item.album ? (item.album.cover_big || item.album.cover_medium || item.album.cover) : '',
          previewUrl: item.preview || '',
          source: 'Deezer'
        }));
        resolve(mapped);
      } else {
        resolve([]);
      }
    };

    script.src = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=15&output=jsonp&callback=${cbName}`;
    document.body.appendChild(script);
  });
}

function renderSearchResults(results) {
  if (results.length === 0) {
    searchResults.innerHTML = `<div style="color: var(--text-dim); grid-column: 1/-1; text-align: center; padding: 2rem;">No matching songs found. You can paste any Spotify link or manually enter details below.</div>`;
    return;
  }

  searchResults.innerHTML = results.map((r, idx) => `
    <div class="song-card" onclick="selectSongByIndex(${idx})">
      <img src="${r.artworkUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%231e293b%22/><text x=%2250%22 y=%2255%22 fill=%22%2364748b%22 text-anchor=%22middle%22>🎵</text></svg>'}" class="song-art" alt="${escapeHtml(r.trackTitle)}">
      <div class="song-info">
        <div class="title">${escapeHtml(r.trackTitle)}</div>
        <div class="artist">${escapeHtml(r.artistName)}</div>
        <div class="meta">${escapeHtml(r.albumName || 'Single')} • ${formatDuration(r.durationSec)} ${r.source ? `• ${r.source}` : ''}</div>
      </div>
    </div>
  `).join('');

  window._lastSearchResults = results;
}

function updateSpotifyLiveEmbed(trackIdOrUrl) {
  const container = document.getElementById('spotify-embed-container');
  const iframe = document.getElementById('spotify-live-iframe');
  const openLink = document.getElementById('spotify-open-link');
  if (!container || !iframe) return;

  const cleanId = extractSpotifyTrackId(trackIdOrUrl);
  if (cleanId) {
    const embedUrl = `https://open.spotify.com/embed/track/${cleanId}?utm_source=generator&si=8e6551032ae54f7d`;
    if (iframe.src !== embedUrl) {
      iframe.src = embedUrl;
    }
    if (openLink) {
      openLink.href = `https://open.spotify.com/track/${cleanId}`;
    }
    container.style.display = 'block';
  } else {
    container.style.display = 'none';
    iframe.src = '';
  }
}


let cachedAudioApiBase = null;
async function getAudioApiBase() {
  if (cachedAudioApiBase !== null) return cachedAudioApiBase;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    cachedAudioApiBase = '';
    return '';
  }
  // Try probing local SyllDB server on port 8088
  try {
    const probe = await fetch('http://localhost:8088/api/status', {
      method: 'GET',
      mode: 'cors',
      signal: AbortSignal.timeout(1000)
    });
    if (probe.ok) {
      cachedAudioApiBase = 'http://localhost:8088';
      return 'http://localhost:8088';
    }
  } catch (_) {}
  cachedAudioApiBase = null;
  return null;
}

let procSimTimer = null;

function showAudioProcessingModal(song) {
  const modal = document.getElementById('audio-processing-modal');
  if (!modal) return;

  const art = document.getElementById('proc-track-art');
  const title = document.getElementById('proc-track-title');
  const artist = document.getElementById('proc-track-artist');

  if (art) art.src = song?.artworkUrl || 'icon.svg';
  if (title) title.textContent = song?.trackTitle || 'Audio Track';
  if (artist) artist.textContent = `${song?.artistName || 'Artist'} • ${song?.albumName || 'Track'}`;

  setProcStepState('step-yt-search', 'active');
  setProcStepState('step-yt-download', 'pending');
  setProcStepState('step-yt-convert', 'pending');
  setProcStepState('step-yt-mount', 'pending');

  const pBar = document.getElementById('proc-progress-bar');
  const pLabel = document.getElementById('proc-status-label');
  if (pBar) pBar.style.width = '15%';
  if (pLabel) pLabel.textContent = 'Searching YouTube Music via yt-dlp...';

  modal.style.display = 'flex';
}

// ----------------------------------------------------
// YouTube Audio Bridge with Anti-Ad & Anti-Desync Shield
// ----------------------------------------------------
window.onYouTubeIframeAPIReady = function() {
  state.ytPlayer = new YT.Player('yt-player', {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      fs: 0,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
      origin: window.location.origin
    },
    events: {
      onReady: () => {
        state.ytReady = true;
        console.log('[YouTube Bridge] Player ready');
        if (state.pendingYtVideoId) {
          loadYouTubeVideo(state.pendingYtVideoId, state.selectedSong);
          state.pendingYtVideoId = null;
        }
      },
      onStateChange: handleYtStateChange,
      onError: (err) => {
        console.warn('[YouTube Bridge] Player error:', err);
      }
    }
  });
};

function handleYtStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    state.isPlaying = true;
    btnPlayPause.textContent = '⏸';
    startYouTubeSyncLoop();
    hidePreviewLoadingOverlay(true);
  } else if (event.data === YT.PlayerState.PAUSED) {
    state.isPlaying = false;
    btnPlayPause.textContent = '▶';
    stopYouTubeSyncLoop();
  } else if (event.data === 5) { // YT.PlayerState.CUED = 5
    hidePreviewLoadingOverlay(true);
  } else if (event.data === YT.PlayerState.ENDED) {
    state.isPlaying = false;
    btnPlayPause.textContent = '▶';
    stopYouTubeSyncLoop();
    audioScrubber.value = 0;
    timeCurrent.textContent = '00:00';
  }
}

function startYouTubeSyncLoop() {
  stopYouTubeSyncLoop();
  state.ytSyncTimer = setInterval(() => {
    if (!state.ytPlayer || typeof state.ytPlayer.getCurrentTime !== 'function') return;
    const curTime = state.ytPlayer.getCurrentTime();
    const dur = state.ytPlayer.getDuration();

    // Anti-Ad & Anti-Desync Shield:
    // If the video hasn't reached authentic playback (> 0.08s) or is stuck in an ad preroll,
    // lock lyrics clock at 0.00 so lyrics never desync.
    if (curTime < 0.08 && state.ytAntiAdLocked) {
      timeCurrent.textContent = '00:00 (Shield)';
      syncKaraokeVisualizer(0);
      return;
    }

    state.ytAntiAdLocked = false;

    if (!state.isDraggingScrubber) {
      audioScrubber.value = curTime;
      timeCurrent.textContent = formatDuration(Math.round(curTime));
    }
    if (dur && dur > 0) {
      audioScrubber.max = dur;
      timeTotal.textContent = formatDuration(Math.round(dur));
    }
    syncKaraokeVisualizer(curTime);
  }, 40);
}

function stopYouTubeSyncLoop() {
  if (state.ytSyncTimer) {
    clearInterval(state.ytSyncTimer);
    state.ytSyncTimer = null;
  }
}

let isYtDockMini = false;
function toggleYtDockMini() {
  const dock = document.getElementById('yt-player-dock');
  if (!dock) return;
  isYtDockMini = !isYtDockMini;
  if (isYtDockMini) {
    dock.style.height = '26px';
    dock.style.width = '150px';
    dock.style.opacity = '0.7';
  } else {
    dock.style.height = '124px';
    dock.style.width = '220px';
    dock.style.opacity = '1';
  }
}

async function resolveAndLoadYouTubeAudio(song) {
  if (!song) return null;
  const title = song.trackTitle || '';
  const artist = song.artistName || '';
  const q = `${title} ${artist}`.trim();
  if (!q) return null;

  try {
    const res = await fetch(`/api/youtube-search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    if (data.success && data.videoId) {
      loadYouTubeVideo(data.videoId, song);
      return data.videoId;
    }
  } catch (err) {
    console.warn('[YouTube Audio] Resolver notice:', err.message);
  }
  return null;
}

function loadYouTubeVideo(videoId, song) {
  state.audioMode = 'youtube';
  state.ytVideoId = videoId;
  state.ytAntiAdLocked = true;

  // Show dock
  const dock = document.getElementById('yt-player-dock');
  if (dock) dock.style.display = 'block';

  // Pause HTML5 audio
  audioEngine.pause();
  audioEngine.removeAttribute('src');

  if (state.ytPlayer && state.ytReady && state.ytPlayer.cueVideoById) {
    state.ytPlayer.cueVideoById(videoId);
  } else {
    state.pendingYtVideoId = videoId;
  }

  const dur = song?.durationSec || 180;
  audioScrubber.max = dur;
  timeTotal.textContent = formatDuration(dur);

  const bannerStatus = document.getElementById('banner-preview-status');
  if (bannerStatus) {
    bannerStatus.innerHTML = '🛡️ YouTube Audio (Anti-Ad Shield)';
    bannerStatus.className = 'pill-badge green';
  }
}

let previewLoaderTimer = null;

function showPreviewLoadingOverlay(song) {
  const overlay = document.getElementById('preview-audio-loader');
  if (!overlay) return;

  const subtitle = document.getElementById('preview-loader-subtitle');
  const bar = document.getElementById('preview-loader-bar');
  const status = document.getElementById('preview-loader-status');

  if (subtitle) {
    subtitle.textContent = song?.trackTitle ? `${song.trackTitle} • ${song.artistName || 'Artist'}` : 'Engaging anti-ad shield & audio stream...';
  }
  if (bar) bar.style.width = '25%';
  if (status) {
    status.textContent = 'Resolving ad-blocked YouTube audio...';
    status.style.color = '#1ed760';
  }

  overlay.classList.remove('fade-out');
  overlay.style.display = 'flex';

  let p = 25;
  if (previewLoaderTimer) clearInterval(previewLoaderTimer);
  previewLoaderTimer = setInterval(() => {
    p = Math.min(p + 15, 88);
    if (bar) bar.style.width = `${p}%`;
    if (status) {
      if (p >= 50 && p < 75) status.textContent = '🛡️ Shielding from ads & prerolls...';
      else if (p >= 75) status.textContent = 'Synchronizing waveforms with lyrics...';
    }
  }, 180);
}

function hidePreviewLoadingOverlay(isSuccess = true, customMsg = null) {
  if (previewLoaderTimer) {
    clearInterval(previewLoaderTimer);
    previewLoaderTimer = null;
  }
  const overlay = document.getElementById('preview-audio-loader');
  const bar = document.getElementById('preview-loader-bar');
  const status = document.getElementById('preview-loader-status');

  if (bar) bar.style.width = '100%';
  if (status) {
    status.textContent = customMsg || (isSuccess ? '✓ YouTube Audio Ready (Anti-Ad Shield Active)' : '⚠️ Audio Ready (Synthesized Timing)');
    status.style.color = isSuccess ? '#1ed760' : '#f59e0b';
  }

  setTimeout(() => {
    if (overlay) {
      overlay.classList.add('fade-out');
      setTimeout(() => {
        overlay.style.display = 'none';
        overlay.classList.remove('fade-out');
      }, 350);
    }
  }, 400);
}

async function autoLoadYouTubeAudioForPreview(song) {
  if (!song) return;
  const currentKey = `${song.trackTitle}_${song.artistName}`.trim().toLowerCase();
  if (state.audioMode === 'youtube' && state.loadedYtKey === currentKey && state.ytVideoId) {
    return;
  }

  showPreviewLoadingOverlay(song);
  try {
    const videoId = await resolveAndLoadYouTubeAudio(song);
    if (videoId) {
      state.loadedYtKey = currentKey;
      hidePreviewLoadingOverlay(true);
    } else {
      hidePreviewLoadingOverlay(false, 'Synthesized Timing (No YouTube stream found)');
    }
  } catch (err) {
    console.warn('[YouTube Audio] Auto-load notice:', err.message);
    hidePreviewLoadingOverlay(false, 'Synthesized Timing Mode');
  }
}

function triggerYouTubeAudioSwitch() {
  if (!state.selectedSong) return;
  autoLoadYouTubeAudioForPreview(state.selectedSong);
}

function dismissAudioProcessingModal() {
  const modal = document.getElementById('audio-processing-modal');
  if (modal) modal.style.display = 'none';
  if (procSimTimer) {
    clearInterval(procSimTimer);
    procSimTimer = null;
  }
}

function setProcStepState(stepId, state) {
  const el = document.getElementById(stepId);
  if (!el) return;
  el.classList.remove('active', 'completed');
  if (state === 'active') el.classList.add('active');
  if (state === 'completed') el.classList.add('completed');
}

async function fetchFullYtDlpAudio(song, showModal = true) {
  if (!song) return;

  const apiBase = await getAudioApiBase();
  const cleanId = (song.spotifyTrackId || '').replace('spotify:track:', '').trim();
  const title = song.trackTitle || '';
  const artist = song.artistName || '';

  const bannerStatus = document.getElementById('banner-preview-status');
  if (bannerStatus) bannerStatus.textContent = '⏳ Loading Audio...';

  if (showModal) {
    showAudioProcessingModal(song);
  }

  // If running on a cloud deployment where local backend is not reachable:
  if (apiBase === null && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    const pLabel = document.getElementById('proc-status-label');
    if (pLabel) pLabel.textContent = 'Connecting to YouTube Audio with Anti-Ad Shield...';
    setProcStepState('step-yt-search', 'active');

    try {
      const videoId = await resolveAndLoadYouTubeAudio(song);
      if (procSimTimer) {
        clearInterval(procSimTimer);
        procSimTimer = null;
      }
      if (videoId) {
        setProcStepState('step-yt-search', 'completed');
        setProcStepState('step-yt-download', 'completed');
        setProcStepState('step-yt-convert', 'completed');
        setProcStepState('step-yt-mount', 'completed');

        const pBar = document.getElementById('proc-progress-bar');
        if (pBar) pBar.style.width = '100%';
        if (pLabel) pLabel.textContent = '✓ YouTube Audio Ready (Anti-Ad Shield Active)';

        setTimeout(() => {
          dismissAudioProcessingModal();
        }, 550);
        return;
      }
    } catch (ytErr) {
      console.warn('YouTube bridge fallback notice:', ytErr);
    }
  }

  // Visual simulation timer for progress bar feedback
  let progress = 20;
  if (procSimTimer) clearInterval(procSimTimer);
  procSimTimer = setInterval(() => {
    progress = Math.min(progress + 4, 92);
    const pBar = document.getElementById('proc-progress-bar');
    const pLabel = document.getElementById('proc-status-label');
    if (pBar) pBar.style.width = `${progress}%`;

    if (progress >= 35 && progress < 65) {
      setProcStepState('step-yt-search', 'completed');
      setProcStepState('step-yt-download', 'active');
      if (pLabel) pLabel.textContent = 'Downloading raw lossless audio stream...';
    } else if (progress >= 65 && progress < 85) {
      setProcStepState('step-yt-download', 'completed');
      setProcStepState('step-yt-convert', 'active');
      if (pLabel) pLabel.textContent = 'Transcoding to 320kbps MP3 via FFmpeg...';
    } else if (progress >= 85) {
      setProcStepState('step-yt-convert', 'completed');
      setProcStepState('step-yt-mount', 'active');
      if (pLabel) pLabel.textContent = 'Synchronizing waveforms in audio engine...';
    }
  }, 220);

  try {
    const base = apiBase || '';
    const url = `${base}/api/ytdlp-audio?spotifyId=${encodeURIComponent(cleanId)}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;
    const res = await fetch(url);

    if (procSimTimer) {
      clearInterval(procSimTimer);
      procSimTimer = null;
    }

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = 'Audio conversion failed';
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error) errMsg = errJson.error;
      } catch (_) {
        errMsg = res.status === 404
          ? 'Endpoint not available on this cloud host. Please use http://localhost:8088.'
          : `Server error (${res.status})`;
      }
      throw new Error(errMsg);
    }

    const data = await res.json();

    if (data.success && data.audioUrl) {
      const fullUrl = data.audioUrl.startsWith('http') ? data.audioUrl : ((base || '') + data.audioUrl);
      song.previewUrl = fullUrl;
      song.fullAudioUrl = fullUrl;

      // Load into audio engine
      audioEngine.src = fullUrl;
      audioEngine.load();

      // Complete all steps in modal
      setProcStepState('step-yt-search', 'completed');
      setProcStepState('step-yt-download', 'completed');
      setProcStepState('step-yt-convert', 'completed');
      setProcStepState('step-yt-mount', 'completed');

      const pBar = document.getElementById('proc-progress-bar');
      const pLabel = document.getElementById('proc-status-label');
      if (pBar) pBar.style.width = '100%';
      if (pLabel) pLabel.textContent = `✓ Full Track Audio Ready (${data.cached ? 'Instant Cache' : 'Converted'})`;

      if (bannerStatus) bannerStatus.textContent = '🟢 Full Track (yt-dlp MP3)';

      // Auto dismiss modal smoothly
      setTimeout(() => {
        dismissAudioProcessingModal();
      }, 550);
      return fullUrl;
    } else {
      throw new Error(data.error || 'Audio conversion failed');
    }
  } catch (err) {
    if (procSimTimer) {
      clearInterval(procSimTimer);
      procSimTimer = null;
    }
    console.warn('yt-dlp audio fetch notice:', err.message);
    const pLabel = document.getElementById('proc-status-label');
    if (pLabel) {
      if (err.message.includes('localhost:8088')) {
        pLabel.innerHTML = `⚠️ ${err.message}`;
      } else {
        pLabel.textContent = `Notice: ${err.message}`;
      }
    }
    if (bannerStatus) bannerStatus.textContent = song.previewUrl ? 'Audio Preview Ready' : 'Synthesized Timing';
    setTimeout(() => {
      dismissAudioProcessingModal();
    }, 2200);
  }
}

function triggerYtDlpAudioFetch() {
  if (!state.selectedSong) {
    alert('Please select or search for a song first.');
    return;
  }
  fetchFullYtDlpAudio(state.selectedSong, true);
}

async function triggerManualBackup() {
  const btn = document.getElementById('btn-backup-now');
  const pill = document.getElementById('backup-status-pill');
  if (btn) btn.disabled = true;
  if (pill) pill.textContent = 'Backing up...';

  try {
    const apiBase = await getAudioApiBase() || '';
    const res = await fetch(`${apiBase}/api/backup-now`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      if (pill) {
        pill.textContent = `Backed Up (${data.totalTracks} songs)`;
        pill.className = 'pill-badge green';
      }
      alert(`✓ SyllDB Backup Complete!\n\nSnapshot: ${data.snapshotName}\nSaved to: Documents/SyllDB-Backup/${data.snapshotName}\nTotal tracks: ${data.totalTracks}\nFiles exported: ${data.totalFiles}`);
    } else {
      throw new Error(data.error || 'Backup routine error');
    }
  } catch (err) {
    alert(`Backup notice: ${err.message}`);
    if (pill) {
      pill.textContent = '24h Auto-Backup Active';
      pill.className = 'pill-badge green';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function selectSongByIndex(idx) {
  const song = window._lastSearchResults[idx];
  if (!song) return;

  state.selectedSong = song;

  // Fill banner
  document.getElementById('banner-art').src = song.artworkUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%231e293b%22/><text x=%2250%22 y=%2255%22 fill=%22%2364748b%22 text-anchor=%22middle%22>🎵</text></svg>';
  document.getElementById('banner-title').textContent = song.trackTitle;
  document.getElementById('banner-artist').textContent = `${song.artistName} • ${song.albumName || 'Single'}`;
  document.getElementById('banner-duration').textContent = formatDuration(song.durationSec);
  
  const idTag = song.spotifyTrackId ? `Spotify ID: ${song.spotifyTrackId}` : (song.itunesId ? `iTunes ID: ${song.itunesId}` : (song.source ? `Source: ${song.source}` : 'Track Ready'));
  document.getElementById('banner-itunes-id').textContent = idTag;
  document.getElementById('banner-preview-status').textContent = 'Audio Preview Ready';

  selectedBanner.style.display = 'flex';
  searchResults.innerHTML = '';
  searchInput.value = '';

  document.getElementById('input-album').value = song.albumName || '';

  // AUTO-POPULATE Track ID / Identifier input & render live Spotify preview embed
  const spotifyInput = document.getElementById('input-spotify-id');
  if (song.spotifyTrackId) {
    spotifyInput.value = song.spotifyTrackId;
    updateSpotifyLiveEmbed(song.spotifyTrackId);
  } else {
    const fallbackId = song.isrc || (song.itunesId ? `itunes_${song.itunesId}` : `track_${Date.now()}`);
    spotifyInput.value = fallbackId;
    updateSpotifyLiveEmbed(null);

    fetch(`/api/resolve-spotify?q=${encodeURIComponent(song.trackTitle + ' ' + song.artistName)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && d.success && d.spotifyTrackId) {
          song.spotifyTrackId = d.spotifyTrackId;
          spotifyInput.value = d.spotifyTrackId;
          updateSpotifyLiveEmbed(d.spotifyTrackId);
          document.getElementById('banner-itunes-id').textContent = `Spotify ID: ${d.spotifyTrackId}`;
        }
      })
      .catch(() => {});
  }

  if (song.previewUrl) {
    audioEngine.src = song.previewUrl;
    audioEngine.load();
    document.getElementById('banner-preview-status').textContent = 'Audio Preview Ready';
  } else {
    audioEngine.removeAttribute('src');
    document.getElementById('banner-preview-status').textContent = 'Synthesized Timing';
  }

  // On localhost, automatically pre-fetch full yt-dlp audio in the background without blocking the UI
  if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    fetchFullYtDlpAudio(song, false);
  } else {
    // On cloud, automatically bridge to YouTube audio with Anti-Ad Shield
    resolveAndLoadYouTubeAudio(song);
  }
}

function clearSelectedSong() {
  state.selectedSong = null;
  selectedBanner.style.display = 'none';
  audioEngine.removeAttribute('src');
  if (state.ytPlayer && typeof state.ytPlayer.stopVideo === 'function') {
    state.ytPlayer.stopVideo();
  }
  const dock = document.getElementById('yt-player-dock');
  if (dock) dock.style.display = 'none';
  state.audioMode = 'virtual';
  const spotifyInput = document.getElementById('input-spotify-id');
  if (spotifyInput) spotifyInput.value = '';
  updateSpotifyLiveEmbed(null);
}

// ----------------------------------------------------
// Step 2: Upload or Parse Lyrics
// ----------------------------------------------------
function initDropzone() {
  const dropzone = document.getElementById('lyrics-dropzone');
  const fileInput = document.getElementById('file-input');

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleLyricsFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleLyricsFile(fileInput.files[0]);
    }
  });
}

function handleLyricsFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const content = e.target.result;
    state.rawContent = content;

    const ext = file.name.split('.').pop().toLowerCase();
    let format = 'auto';
    if (ext === 'ttml' || ext === 'xml') format = 'ttml';
    else if (ext === 'elrc' || ext === 'lrc') format = 'elrc';
    else if (ext === 'ass') format = 'ass';
    else if (ext === 'json') format = 'json';
    else if (ext === 'txt') format = 'static';

    await parseAndAdvance(content, format);
  };
  reader.readAsText(file);
}

function toggleRawTextarea() {
  const wrapper = document.getElementById('raw-textarea-wrapper');
  const btn = document.getElementById('btn-toggle-raw');
  const isHidden = wrapper.style.display === 'none' || !wrapper.style.display;
  wrapper.style.display = isHidden ? 'block' : 'none';
  btn.querySelector('span').textContent = isHidden ? '▼' : '▶';
}

async function parseRawLyricsText() {
  const text = document.getElementById('raw-lyrics-input').value.trim();
  const format = document.getElementById('raw-format-select').value;
  if (!text) {
    alert('Please paste some lyrics text first.');
    return;
  }
  state.rawContent = text;
  await parseAndAdvance(text, format);
}

async function parseAndAdvance(rawText, format) {
  try {
    const payload = { raw: rawText, format };
    if (state.manualLyricType && state.manualLyricType !== 'auto') {
      payload.type = state.manualLyricType;
    }

    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(`Parse Error: ${data.error || 'Failed to parse lyrics'}`);
      return;
    }

    state.parsedLyrics = data.lyrics;
    state.detectedFormat = data.format;
    state.sourceFormat = data.format;
    state.stats = data.stats;

    if (state.manualLyricType && state.manualLyricType !== 'auto') {
      state.parsedLyrics.Type = state.manualLyricType;
    }

    // Update detected badge
    const badge = document.getElementById('badge-detected-type');
    if (badge) {
      const type = state.parsedLyrics.Type || 'Syllable';
      badge.textContent = state.manualLyricType !== 'auto' ? `Selected: ${type}` : `Detected: ${type}`;
      badge.className = `pill-badge ${getTypeBadgeColor(type)}`;
    }

    // Enable button
    const btn = document.getElementById('btn-next-to-preview');
    btn.disabled = false;

    // Advance to Step 3
    goToStep(3);
  } catch (err) {
    alert(`Parse failed: ${err.message}`);
  }
}

// ----------------------------------------------------
// Step 3: Interactive Karaoke Preview & Audio Engine
// ----------------------------------------------------
function initAudioEngine() {
  audioEngine.addEventListener('loadedmetadata', () => {
    audioScrubber.max = audioEngine.duration;
    timeTotal.textContent = formatDuration(Math.round(audioEngine.duration));
  });

  audioEngine.addEventListener('timeupdate', () => {
    if (!state.isDraggingScrubber) {
      audioScrubber.value = audioEngine.currentTime;
      timeCurrent.textContent = formatDuration(Math.round(audioEngine.currentTime));
    }
    syncKaraokeVisualizer(audioEngine.currentTime);
  });

  audioEngine.addEventListener('ended', () => {
    state.isPlaying = false;
    btnPlayPause.textContent = '▶';
  });

  audioScrubber.addEventListener('input', () => {
    state.isDraggingScrubber = true;
    timeCurrent.textContent = formatDuration(Math.round(audioScrubber.value));
    syncKaraokeVisualizer(parseFloat(audioScrubber.value));
  });

  audioScrubber.addEventListener('change', () => {
    state.isDraggingScrubber = false;
    const seekTime = parseFloat(audioScrubber.value);
    if (state.audioMode === 'youtube' && state.ytPlayer && state.ytReady && typeof state.ytPlayer.seekTo === 'function') {
      state.ytPlayer.seekTo(seekTime, true);
    } else if (audioEngine.src) {
      audioEngine.currentTime = seekTime;
    } else {
      state.virtualTime = seekTime;
    }
    syncKaraokeVisualizer(seekTime);
  });

  // Custom audio file picker
  const customAudioInput = document.getElementById('custom-audio-input');
  customAudioInput.addEventListener('change', () => {
    if (customAudioInput.files && customAudioInput.files.length > 0) {
      const file = customAudioInput.files[0];
      const url = URL.createObjectURL(file);
      state.audioMode = 'html5';
      if (state.ytPlayer && typeof state.ytPlayer.stopVideo === 'function') {
        state.ytPlayer.stopVideo();
      }
      const dock = document.getElementById('yt-player-dock');
      if (dock) dock.style.display = 'none';
      audioEngine.src = url;
      audioEngine.load();
      alert(`Loaded audio file: ${file.name}`);
    }
  });
}

function togglePlayPause() {
  if (state.audioMode === 'youtube' && state.ytPlayer && state.ytReady && typeof state.ytPlayer.getPlayerState === 'function') {
    const ytState = state.ytPlayer.getPlayerState();
    if (ytState === 1) { // 1 = PLAYING
      state.ytPlayer.pauseVideo();
      state.isPlaying = false;
      btnPlayPause.textContent = '▶';
    } else {
      state.ytPlayer.playVideo();
      state.isPlaying = true;
      btnPlayPause.textContent = '⏸';
    }
  } else if (audioEngine.src) {
    if (audioEngine.paused) {
      audioEngine.play();
      state.isPlaying = true;
      btnPlayPause.textContent = '⏸';
    } else {
      audioEngine.pause();
      state.isPlaying = false;
      btnPlayPause.textContent = '▶';
    }
  } else {
    // Virtual timer mode if no audio file is attached
    if (state.virtualTimer) {
      clearInterval(state.virtualTimer);
      state.virtualTimer = null;
      state.isPlaying = false;
      btnPlayPause.textContent = '▶';
    } else {
      state.isPlaying = true;
      btnPlayPause.textContent = '⏸';
      const maxDuration = state.stats ? state.stats.duration : 180;
      audioScrubber.max = maxDuration;
      timeTotal.textContent = formatDuration(maxDuration);

      state.virtualTimer = setInterval(() => {
        state.virtualTime += 0.05;
        if (state.virtualTime >= maxDuration) {
          state.virtualTime = 0;
          clearInterval(state.virtualTimer);
          state.virtualTimer = null;
          state.isPlaying = false;
          btnPlayPause.textContent = '▶';
        }
        audioScrubber.value = state.virtualTime;
        timeCurrent.textContent = formatDuration(Math.round(state.virtualTime));
        syncKaraokeVisualizer(state.virtualTime);
      }, 50);
    }
  }
}

function setPlaybackRate(rate) {
  if (state.audioMode === 'youtube' && state.ytPlayer && typeof state.ytPlayer.setPlaybackRate === 'function') {
    state.ytPlayer.setPlaybackRate(rate);
  } else if (audioEngine) {
    audioEngine.playbackRate = rate;
  }
}

function renderKaraokePreview() {
  if (!state.parsedLyrics || !state.parsedLyrics.Content) {
    karaokeStage.innerHTML = `<div style="text-align: center; color: var(--text-dim); margin-top: 60px;">No lyrics content loaded.</div>`;
    return;
  }

  const type = state.parsedLyrics.Type || 'Syllable';
  const typeColor = getTypeBadgeColor(type);
  const typeIcon = getTypeIcon(type);

  document.getElementById('preview-stat-format').innerHTML = `<span class="pill-badge ${typeColor}" style="padding: 2px 8px; font-size: 0.78rem;">${typeIcon} ${escapeHtml(type)}</span>`;
  document.getElementById('preview-stat-lines').textContent = state.stats ? state.stats.lines : state.parsedLyrics.Content.length;
  document.getElementById('preview-stat-syllables').textContent = (type === 'Static' || type === 'Line') ? '-' : (state.stats ? state.stats.syllables : '-');
  document.getElementById('preview-source-badge').textContent = (state.detectedFormat || 'TEXT').toUpperCase();

  const content = state.parsedLyrics.Content;
  let html = '';

  content.forEach((lineItem, lIdx) => {
    const isOpposite = lineItem.OppositeAligned;
    const oppositeClass = isOpposite ? 'opposite' : '';

    if (lineItem.Lead && lineItem.Lead.Syllables) {
      const lineStart = lineItem.Lead.StartTime;
      const lineEnd = lineItem.Lead.EndTime;

      html += `<div class="lyric-line ${oppositeClass}" id="line-${lIdx}" data-start="${lineStart}" data-end="${lineEnd}" onclick="seekToTime(${lineStart})">`;
      lineItem.Lead.Syllables.forEach((syl, sIdx) => {
        const space = syl.IsPartOfWord ? '' : '&nbsp;';
        html += `<span class="syllable-span" id="syl-${lIdx}-${sIdx}" data-start="${syl.StartTime}" data-end="${syl.EndTime}">${escapeHtml(syl.Text)}</span>${space}`;
      });

      if (lineItem.Background && lineItem.Background.length > 0) {
        lineItem.Background.forEach((bg, bgIdx) => {
          html += `<div class="bg-vocals" id="bg-${lIdx}-${bgIdx}" data-start="${bg.StartTime}" data-end="${bg.EndTime}">`;
          (bg.Syllables || []).forEach(s => {
            html += `${escapeHtml(s.Text)} `;
          });
          html += `</div>`;
        });
      }

      html += `</div>`;
    } else if (lineItem.Text) {
      const lineStart = lineItem.StartTime || 0;
      const lineEnd = lineItem.EndTime || 0;
      html += `<div class="lyric-line ${oppositeClass}" id="line-${lIdx}" data-start="${lineStart}" data-end="${lineEnd}" onclick="seekToTime(${lineStart})">
        ${escapeHtml(lineItem.Text)}
      </div>`;
    }
  });

  karaokeStage.innerHTML = html;
}

function seekToTime(t) {
  if (audioEngine.src) {
    audioEngine.currentTime = t;
  } else {
    state.virtualTime = t;
  }
  audioScrubber.value = t;
  timeCurrent.textContent = formatDuration(Math.round(t));
  syncKaraokeVisualizer(t);
}

let lastActiveLineIdx = -1;

function syncKaraokeVisualizer(currentTime) {
  if (!state.parsedLyrics || !state.parsedLyrics.Content) return;

  const content = state.parsedLyrics.Content;
  let activeIdx = -1;

  for (let i = 0; i < content.length; i++) {
    const item = content[i];
    const start = item.Lead ? item.Lead.StartTime : (item.StartTime || 0);
    const end = item.Lead ? item.Lead.EndTime : (item.EndTime || start + 3);

    if (currentTime >= start && currentTime <= end + 0.2) {
      activeIdx = i;
      break;
    }
  }

  if (activeIdx !== -1 && activeIdx !== lastActiveLineIdx) {
    document.querySelectorAll('.lyric-line.active').forEach(el => el.classList.remove('active'));
    const lineEl = document.getElementById(`line-${activeIdx}`);
    if (lineEl) {
      lineEl.classList.add('active');
      lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    lastActiveLineIdx = activeIdx;
  }

  // Syllable sweeps
  if (activeIdx !== -1) {
    const lineItem = content[activeIdx];
    if (lineItem.Lead && lineItem.Lead.Syllables) {
      lineItem.Lead.Syllables.forEach((syl, sIdx) => {
        const sylEl = document.getElementById(`syl-${activeIdx}-${sIdx}`);
        if (sylEl) {
          if (currentTime >= syl.StartTime) {
            sylEl.classList.add('highlighted');
          } else {
            sylEl.classList.remove('highlighted');
          }
        }
      });
    }
  }
}

// ----------------------------------------------------
// Step 4: Publish Live
// ----------------------------------------------------
function preparePublishSummary() {
  const song = state.selectedSong || {
    trackTitle: 'Custom Track',
    artistName: 'Unknown Artist',
    albumName: document.getElementById('input-album').value || 'Custom',
    artworkUrl: ''
  };

  const spotifyId = document.getElementById('input-spotify-id').value.trim() || `custom_${Date.now()}`;
  const finalType = state.parsedLyrics?.Type || 'Syllable';
  const typeBadge = document.getElementById('publish-type-badge');
  const typeColor = getTypeBadgeColor(finalType);
  const typeIcon = getTypeIcon(finalType);

  document.getElementById('publish-art').src = song.artworkUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%231e293b%22/><text x=%2250%22 y=%2255%22 fill=%22%2364748b%22 text-anchor=%22middle%22>🎵</text></svg>';
  document.getElementById('publish-title').textContent = song.trackTitle;
  document.getElementById('publish-artist').textContent = `${song.artistName} • ${song.albumName || 'Single'}`;
  
  if (typeBadge) {
    typeBadge.textContent = `${typeIcon} ${finalType} Synced`;
    typeBadge.className = `pill-badge ${typeColor}`;
  }

  const typeSelect = document.getElementById('publish-type-select');
  if (typeSelect) {
    typeSelect.value = finalType;
  }

  document.getElementById('publish-format-badge').textContent = (state.detectedFormat || 'TTML').toUpperCase();
  document.getElementById('publish-id-badge').textContent = `Spotify ID: ${spotifyId.replace('spotify:track:', '')}`;

  const aiBadge = document.getElementById('publish-ai-badge');
  if (aiBadge) {
    aiBadge.style.display = state.isAlignmenter ? 'inline-flex' : 'none';
  }

  document.getElementById('publish-success-card').style.display = 'none';
  document.getElementById('btn-publish-live').style.display = 'inline-flex';
}

function onPublishTypeChange(newType) {
  if (state.parsedLyrics) {
    state.parsedLyrics.Type = newType;
  }
  const typeBadge = document.getElementById('publish-type-badge');
  if (typeBadge) {
    const typeColor = getTypeBadgeColor(newType);
    const typeIcon = getTypeIcon(newType);
    typeBadge.textContent = `${typeIcon} ${newType} Synced`;
    typeBadge.className = `pill-badge ${typeColor}`;
  }
}

async function publishLyricsLive() {
  const btn = document.getElementById('btn-publish-live');
  btn.disabled = true;
  btn.textContent = 'Publishing...';

  const song = state.selectedSong || {};
  let spotifyId = document.getElementById('input-spotify-id').value.trim();
  if (spotifyId.startsWith('spotify:track:')) {
    spotifyId = spotifyId.replace('spotify:track:', '');
  }
  if (!spotifyId) {
    spotifyId = `track_${Date.now()}`;
  }

  const isAlignmenter = Boolean(state.isAlignmenter);
  const chosenType = document.getElementById('publish-type-select')?.value || state.parsedLyrics?.Type || 'Syllable';

  // Embed perfect matching metadata & Alignmenter flag into canonical JSON
  if (state.parsedLyrics) {
    state.parsedLyrics.Type = chosenType;
    state.parsedLyrics.IsAlignmenter = isAlignmenter;
    state.parsedLyrics.AiSynced = isAlignmenter;
    if (isAlignmenter) {
      state.parsedLyrics.Source = "Alignmenter";
    }
    state.parsedLyrics.TrackTitle = song.trackTitle || '';
    state.parsedLyrics.ArtistName = song.artistName || '';
    state.parsedLyrics.DurationSec = song.durationSec || 0;
    state.parsedLyrics.SpotifyTrackId = spotifyId;
  }

  const payload = {
    spotify_track_id: spotifyId,
    track_title: song.trackTitle || 'Custom Song',
    artist_name: song.artistName || 'Custom Artist',
    album_name: document.getElementById('input-album').value.trim() || song.albumName || '',
    duration_sec: song.durationSec || 0,
    lyrics_type: chosenType,
    type: chosenType,
    source_format: state.sourceFormat || 'ttml',
    raw_content: state.rawContent || '',
    canonical_json: state.parsedLyrics,
    artwork_url: song.artworkUrl || '',
    preview_url: song.previewUrl || '',
    is_alignmenter: isAlignmenter ? 1 : 0
  };

  try {
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(`Publish failed: ${data.error || 'Server error'}`);
      btn.disabled = false;
      btn.textContent = '🚀 Publish Live to Database';
      return;
    }

    // Success
    btn.style.display = 'none';
    const card = document.getElementById('publish-success-card');
    card.style.display = 'block';

    const cleanId = payload.spotify_track_id;
    const endpoint = `${window.location.origin}/api/lyrics/${cleanId}`;
    document.getElementById('api-endpoint-url').textContent = endpoint;

    checkServerStatus();
    loadManagerSongs();
  } catch (err) {
    alert(`Network error: ${err.message}`);
    btn.disabled = false;
    btn.textContent = '🚀 Publish Live to Database';
  }
}

function copyApiUrl() {
  const url = document.getElementById('api-endpoint-url').textContent;
  navigator.clipboard.writeText(url).then(() => {
    alert('Copied Spotify Pro endpoint URL to clipboard!');
  });
}

function viewInManager() {
  switchTab('tab-manager');
}

function resetWizard() {
  state.selectedSong = null;
  state.parsedLyrics = null;
  state.rawContent = '';
  document.getElementById('input-spotify-id').value = '';
  document.getElementById('input-album').value = '';
  document.getElementById('raw-lyrics-input').value = '';
  setManualLyricType('auto');
  clearSelectedSong();
  goToStep(1);
}

// ----------------------------------------------------
// Tab 2: Web TTML Manager
// ----------------------------------------------------
async function loadManagerSongs() {
  const tbody = document.getElementById('manager-songs-tbody');
  const emptyState = document.getElementById('manager-empty-state');
  try {
    const res = await fetch('/api/all');
    const data = await res.json();
    state.managerSongs = data.items || [];

    if (state.managerSongs.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';
    renderManagerTable(state.managerSongs);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color: #ef4444;">Failed to load songs: ${err.message}</td></tr>`;
  }
}

function renderManagerTable(items) {
  const tbody = document.getElementById('manager-songs-tbody');
  tbody.innerHTML = items.map(item => `
    <tr>
      <td>
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="${item.artwork_url || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%231e293b%22/><text x=%2250%22 y=%2255%22 fill=%22%2364748b%22 text-anchor=%22middle%22>🎵</text></svg>'}" style="width: 44px; height: 44px; border-radius: 6px; object-fit: cover;">
          <div>
            <div style="font-weight: 600; color: #fff;">${escapeHtml(item.track_title)}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(item.artist_name)}</div>
          </div>
        </div>
      </td>
      <td>
        <span class="pill-badge">${escapeHtml(item.source_format.toUpperCase())}</span>
        ${item.is_alignmenter ? '<span class="pill-badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); margin-left: 4px;">✨ Alignmenter</span>' : ''}
      </td>
      <td>
        <span class="pill-badge ${getTypeBadgeColor(item.lyrics_type)}">${getTypeIcon(item.lyrics_type)} ${escapeHtml(item.lyrics_type || 'Syllable')}</span>
      </td>
      <td>
        <code style="font-size: 0.82rem; color: #67e8f9;">${escapeHtml(item.spotify_track_id)}</code>
      </td>
      <td style="font-size: 0.8rem; color: var(--text-muted);">
        ${new Date(item.updated_at).toLocaleDateString()}
      </td>
      <td style="text-align: right;">
        <div style="display: inline-flex; gap: 6px;">
          <button class="btn-icon" onclick="previewItemFromManager(${item.id})">🎧 Preview</button>
          <button class="btn-icon" onclick="openEditModal(${item.id})">✏️ Edit</button>
          <button class="btn-icon" onclick="exportItem(${item.id}, 'ttml')">TTML</button>
          <button class="btn-icon" onclick="exportItem(${item.id}, 'elrc')">ELRC</button>
          <button class="btn-icon" onclick="exportItem(${item.id}, 'ass')">ASS</button>
          <button class="btn-icon danger" onclick="deleteItem(${item.id})">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterManagerSongs() {
  const q = document.getElementById('manager-filter-input').value.toLowerCase().trim();
  if (!q) {
    renderManagerTable(state.managerSongs);
    return;
  }
  const filtered = state.managerSongs.filter(s =>
    (s.track_title && s.track_title.toLowerCase().includes(q)) ||
    (s.artist_name && s.artist_name.toLowerCase().includes(q)) ||
    (s.spotify_track_id && s.spotify_track_id.toLowerCase().includes(q))
  );
  renderManagerTable(filtered);
}

async function previewItemFromManager(id) {
  try {
    const res = await fetch(`/api/item/${id}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      alert('Could not load song item');
      return;
    }

    const item = data.item;
    state.selectedSong = {
      trackTitle: item.track_title,
      artistName: item.artist_name,
      albumName: item.album_name,
      artworkUrl: item.artwork_url,
      previewUrl: item.preview_url,
      durationSec: item.duration_sec
    };

    state.parsedLyrics = item.canonical;
    state.detectedFormat = item.source_format;
    state.sourceFormat = item.source_format;
    state.rawContent = item.raw_content;

    document.getElementById('input-spotify-id').value = item.spotify_track_id;
    document.getElementById('input-album').value = item.album_name || '';

    if (item.preview_url) {
      audioEngine.src = item.preview_url;
      audioEngine.load();
    } else {
      audioEngine.removeAttribute('src');
    }

    switchTab('tab-upload');
    goToStep(3);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// Export item
function exportItem(id, format) {
  window.open(`/api/export/${id}/${format}`, '_blank');
}

// Delete item
async function deleteItem(id) {
  if (!confirm('Are you sure you want to delete this custom lyrics entry from the database?')) return;
  try {
    const res = await fetch(`/api/lyrics/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.success) {
      loadManagerSongs();
      checkServerStatus();
    } else {
      alert(`Delete failed: ${data.error || 'Server error'}`);
    }
  } catch (err) {
    alert(`Network error: ${err.message}`);
  }
}

// ----------------------------------------------------
// Edit Modal
// ----------------------------------------------------
async function openEditModal(id) {
  try {
    const res = await fetch(`/api/item/${id}`);
    const data = await res.json();
    if (!res.ok || !data.item) {
      alert('Failed to load item for editing');
      return;
    }
    const item = data.item;
    document.getElementById('edit-item-id').value = item.id;
    document.getElementById('edit-song-title').value = item.track_title;
    document.getElementById('edit-artist-name').value = item.artist_name;
    document.getElementById('edit-spotify-id').value = item.spotify_track_id;
    document.getElementById('edit-album-name').value = item.album_name || '';
    const normType = item.lyrics_type || (item.canonical && item.canonical.Type) || 'Syllable';
    const typeSelect = document.getElementById('edit-lyric-type');
    if (typeSelect) {
      typeSelect.value = normType;
    }
    document.getElementById('edit-canonical-json').value = JSON.stringify(item.canonical, null, 2);

    document.getElementById('edit-modal').style.display = 'flex';
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
}

async function saveEditedLyrics() {
  const id = document.getElementById('edit-item-id').value;
  const title = document.getElementById('edit-song-title').value.trim();
  const artist = document.getElementById('edit-artist-name').value.trim();
  const spotifyId = document.getElementById('edit-spotify-id').value.trim();
  const album = document.getElementById('edit-album-name').value.trim();
  const lyricType = document.getElementById('edit-lyric-type')?.value || 'Syllable';
  const jsonStr = document.getElementById('edit-canonical-json').value.trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    alert(`Invalid JSON format: ${e.message}`);
    return;
  }

  parsed.Type = lyricType;

  try {
    const res = await fetch(`/api/lyrics/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_title: title,
        artist_name: artist,
        spotify_track_id: spotifyId,
        album_name: album,
        lyrics_type: lyricType,
        type: lyricType,
        canonical_json: parsed
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      closeEditModal();
      loadManagerSongs();
      alert('Changes saved successfully!');
    } else {
      alert(`Save failed: ${data.error || 'Server error'}`);
    }
  } catch (err) {
    alert(`Network error: ${err.message}`);
  }
}

// ----------------------------------------------------
// Tab 3: API Tester
// ----------------------------------------------------
async function testApiQuery() {
  const trackId = document.getElementById('test-track-id').value.trim();
  const out = document.getElementById('test-api-output');
  if (!trackId) {
    alert('Please enter a Spotify Track ID');
    return;
  }

  out.style.display = 'block';
  out.textContent = `Querying /api/lyrics/${trackId}...`;

  try {
    const res = await fetch(`/api/lyrics/${trackId}`);
    if (res.ok) {
      const data = await res.json();
      out.textContent = `HTTP 200 OK:\n\n${JSON.stringify(data, null, 2)}`;
      out.style.color = '#a7f3d0';
    } else {
      const err = await res.json();
      out.textContent = `HTTP ${res.status}:\n\n${JSON.stringify(err, null, 2)}`;
      out.style.color = '#fca5a5';
    }
  } catch (err) {
    out.textContent = `Request error: ${err.message}`;
    out.style.color = '#fca5a5';
  }
}

// ----------------------------------------------------
// Utilities
// ----------------------------------------------------
function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
