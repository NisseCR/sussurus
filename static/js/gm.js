/**
 * gm.js
 * -----
 * UI logic for the GM mixing page.
 * Handles:
 *   - Loading and rendering the audio library (playlists & ambience)
 *   - Tracking the "working state" (what the GM is currently hearing)
 *   - Sending state changes to the server so the GM's local audio reflects them
 *   - Pushing the finalised soundscape to listeners
 *   - Sidebar management (active layers, volume sliders, stop buttons)
 */

/** Working state mirroring the server's session state. */
const gmState = {
  sessionCode: null,
  music: { playlist: null, track: null, volume: 1.0 },
  ambience: {},
  fade: { music_ms: 5000, ambience_ms: 10000 },
};

let library = { playlists: [], ambience: {} };
let audioStarted = false;


// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Entry point — called on DOMContentLoaded.
 * Loads the library, sets up UI, and starts a session if none exists.
 */
async function initGM() {
  await loadLibrary();
  await loadOrCreateSession();
  renderPlaylists();
  renderAmbiencePanel();
  setupFadeControls();
  setupPushButton();
  setupSessionDisplay();
  syncSidebar();
}


// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Load existing session from server, or create a new one.
 * Displays the session code in the header.
 */
async function loadOrCreateSession() {
  const res = await fetch('/api/gm-state');
  const state = await res.json();

  if (state.session_code) {
    gmState.sessionCode = state.session_code;
    gmState.music = { ...state.music, volume: state.music?.volume ?? 1.0 };
    gmState.ambience = state.ambience;
    gmState.fade = state.fade;
  } else {
    await createNewSession();
  }
  updateSessionDisplay();
}

/**
 * Create a new session on the server and update local state.
 */
async function createNewSession() {
  const res = await fetch('/api/session/new', { method: 'POST' });
  const data = await res.json();
  gmState.sessionCode = data.session_code;
  // Reset local working state
  gmState.music = { playlist: null, track: null };
  gmState.ambience = {};
  updateSessionDisplay();
}

/** Update the session code display in the header. */
function updateSessionDisplay() {
  const el = document.getElementById('session-code');
  if (el) el.textContent = gmState.sessionCode ?? '------';
}

/** Wire up the "New Session" button. */
function setupSessionDisplay() {
  const btn = document.getElementById('btn-new-session');
  if (btn) btn.addEventListener('click', async () => {
    if (!confirm('Start a new session? Listeners will need to rejoin.')) return;
    await createNewSession();
    gmState.music = { playlist: null, track: null };
    gmState.ambience = {};
    AudioEngine.stopAll();
    renderPlaylists();
    syncSidebar();
  });
}


// ---------------------------------------------------------------------------
// Library loading
// ---------------------------------------------------------------------------

/**
 * Fetch the audio library from the server and cache locally.
 */
async function loadLibrary() {
  const res = await fetch('/api/audio/library');
  library = await res.json();
}


// ---------------------------------------------------------------------------
// Playlist rendering
// ---------------------------------------------------------------------------

/**
 * Render the music playlist grid.
 * Each playlist becomes a clickable tile with cover art and name.
 */
function renderPlaylists() {
  const grid = document.getElementById('playlist-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!library.playlists.length) {
    grid.innerHTML = '<p class="empty-hint">No playlists found in audio/music/</p>';
    return;
  }

  library.playlists.forEach(playlist => {
    const tile = document.createElement('div');
    tile.className = 'playlist-tile';
    tile.dataset.name = playlist.name;

    if (gmState.music.playlist === playlist.name) {
      tile.classList.add('active');
    }

    const img = document.createElement('div');
    img.className = 'playlist-cover';
    if (playlist.cover) {
      img.style.backgroundImage = `url('${playlist.cover}')`;
    } else {
      img.innerHTML = '<span class="cover-placeholder">♪</span>';
    }

    const label = document.createElement('div');
    label.className = 'playlist-label';
    label.textContent = playlist.name;

    tile.appendChild(img);
    tile.appendChild(label);
    tile.addEventListener('click', () => onPlaylistClick(playlist.name));
    grid.appendChild(tile);
  });
}

/**
 * Handle a playlist tile click.
 * Toggles the playlist: clicking the active one stops music, clicking another switches.
 * @param {string} playlistName
 */
async function onPlaylistClick(playlistName) {
  ensureAudio();

  const isActive = gmState.music.playlist === playlistName;
  const newPlaylist = isActive ? null : playlistName;
  const newTrack    = isActive ? null : (library.playlists.find(p => p.name === playlistName)?.tracks[0] ?? null);
  const newVolume   = isActive ? 1.0  : (gmState.music.volume ?? 1.0);

  gmState.music = { playlist: newPlaylist, track: newTrack, volume: newVolume };

  // Update server state
  await fetch('/api/music', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playlist: newPlaylist, track: newTrack, volume: newVolume }),
  });

  // Apply to local audio
  await AudioEngine.applyState(buildAudioState());

  // Update UI
  renderPlaylists();
  syncSidebar();
}


// ---------------------------------------------------------------------------
// Ambience rendering
// ---------------------------------------------------------------------------

/**
 * Render all ambience categories and their sound tiles.
 */
function renderAmbiencePanel() {
  const panel = document.getElementById('ambience-panel');
  if (!panel) return;
  panel.innerHTML = '';

  const categories = Object.keys(library.ambience);
  if (!categories.length) {
    panel.innerHTML = '<p class="empty-hint">No ambience files found in audio/ambience/</p>';
    return;
  }

  categories.forEach(category => {
    const section = document.createElement('div');
    section.className = 'ambience-category';

    const heading = document.createElement('h3');
    heading.className = 'ambience-category-title';
    heading.textContent = category;
    section.appendChild(heading);

    const tiles = document.createElement('div');
    tiles.className = 'ambience-tiles';

    library.ambience[category].forEach(filename => {
      const key = `${category}/${filename}`;
      const tile = document.createElement('div');
      tile.className = 'ambience-tile';
      tile.dataset.key = key;

      const isActive = gmState.ambience[key]?.active;
      if (isActive) tile.classList.add('active');

      // Strip extension for display
      const displayName = filename.replace(/\.[^.]+$/, '');
      tile.textContent = displayName;

      tile.addEventListener('click', () => onAmbienceClick(key, category, filename));
      tiles.appendChild(tile);
    });

    section.appendChild(tiles);
    panel.appendChild(section);
  });
}

/**
 * Toggle an ambience layer on or off.
 * @param {string} key - "<category>/<filename>"
 * @param {string} category
 * @param {string} filename
 */
async function onAmbienceClick(key, category, filename) {
  ensureAudio();

  const current = gmState.ambience[key];
  const newActive = !current?.active;
  const volume = current?.volume ?? 1.0;

  gmState.ambience[key] = { active: newActive, volume };

  await fetch('/api/ambience', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, active: newActive, volume }),
  });

  await AudioEngine.applyState(buildAudioState());

  // Update ambience tile visual
  const tile = document.querySelector(`.ambience-tile[data-key="${key}"]`);
  if (tile) tile.classList.toggle('active', newActive);

  syncSidebar();
}


// ---------------------------------------------------------------------------
// Fade controls
// ---------------------------------------------------------------------------

/**
 * Bind the fade duration input fields and sync them with the server.
 */
function setupFadeControls() {
  const musicInput = document.getElementById('fade-music');
  const ambienceInput = document.getElementById('fade-ambience');

  if (musicInput) {
    musicInput.value = gmState.fade.music_ms / 1000;
    musicInput.addEventListener('change', async () => {
      const ms = Math.max(0, parseFloat(musicInput.value) * 1000);
      gmState.fade.music_ms = ms;
      await fetch('/api/fade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ music_ms: ms }),
      });
    });
  }

  if (ambienceInput) {
    ambienceInput.value = gmState.fade.ambience_ms / 1000;
    ambienceInput.addEventListener('change', async () => {
      const ms = Math.max(0, parseFloat(ambienceInput.value) * 1000);
      gmState.fade.ambience_ms = ms;
      await fetch('/api/fade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ambience_ms: ms }),
      });
    });
  }
}


// ---------------------------------------------------------------------------
// Push button
// ---------------------------------------------------------------------------

/**
 * Wire up the "Push to Listeners" button.
 * Sends the current server state to all connected listeners.
 */
function setupPushButton() {
  const btn = document.getElementById('btn-push');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    btn.classList.add('pushing');
    btn.textContent = 'Sending…';

    try {
      const res = await fetch('/api/push', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        showPushFeedback('Soundscape pushed ✓');
      }
    } catch (e) {
      showPushFeedback('Push failed ✗', true);
    }

    btn.classList.remove('pushing');
    btn.textContent = 'Push to Listeners';
  });
}

/**
 * Show a brief status message near the push button.
 * @param {string} message
 * @param {boolean} isError
 */
function showPushFeedback(message, isError = false) {
  const el = document.getElementById('push-feedback');
  if (!el) return;
  el.textContent = message;
  el.className = 'push-feedback ' + (isError ? 'error' : 'success');
  setTimeout(() => { el.textContent = ''; el.className = 'push-feedback'; }, 3000);
}


// ---------------------------------------------------------------------------
// Active audio sidebar
// ---------------------------------------------------------------------------

/**
 * Re-render the sidebar to reflect the current working state.
 * Shows music and all active ambience layers with volume sliders.
 */
function syncSidebar() {
  renderSidebarMusic();
  renderSidebarAmbience();
}

/**
 * Render the music section of the sidebar.
 */
function renderSidebarMusic() {
  const section = document.getElementById('sidebar-music');
  if (!section) return;
  section.innerHTML = '';

  if (!gmState.music.playlist) {
    section.innerHTML = '<p class="sidebar-empty">No music playing</p>';
    return;
  }

  const row = document.createElement('div');
  row.className = 'sidebar-row';

  const label = document.createElement('span');
  label.className = 'sidebar-label';
  label.textContent = gmState.music.playlist;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = 0; slider.max = 1; slider.step = 0.01;
  slider.value = gmState.music.volume ?? 1.0;   // restore persisted volume on reload
  slider.className = 'sidebar-slider';
  slider.addEventListener('input', async () => {
    const v = parseFloat(slider.value);
    gmState.music.volume = v;
    AudioEngine.setMusicVolume(v);
    // Keep server state in sync so volume is included in the next push
    await fetch('/api/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlist: gmState.music.playlist, track: gmState.music.track, volume: v }),
    });
  });

  const stopBtn = document.createElement('button');
  stopBtn.className = 'sidebar-stop';
  stopBtn.title = 'Stop music';
  stopBtn.textContent = '✕';
  stopBtn.addEventListener('click', async () => {
    gmState.music = { playlist: null, track: null, volume: 1.0 };
    await fetch('/api/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlist: null, track: null, volume: 1.0 }),
    });
    await AudioEngine.applyState(buildAudioState());
    renderPlaylists();
    syncSidebar();
  });

  row.appendChild(label);
  row.appendChild(slider);
  row.appendChild(stopBtn);
  section.appendChild(row);
}

/**
 * Render all active ambience layers in the sidebar with volume sliders.
 */
function renderSidebarAmbience() {
  const section = document.getElementById('sidebar-ambience');
  if (!section) return;
  section.innerHTML = '';

  const active = Object.entries(gmState.ambience).filter(([, v]) => v.active);

  if (!active.length) {
    section.innerHTML = '<p class="sidebar-empty">No ambience active</p>';
    return;
  }

  active.forEach(([key, layerState]) => {
    const row = document.createElement('div');
    row.className = 'sidebar-row';

    const label = document.createElement('span');
    label.className = 'sidebar-label';
    label.textContent = key.replace(/\.[^.]+$/, '').replace('/', ' / ');

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = 0; slider.max = 1; slider.step = 0.01;
    slider.value = layerState.volume;
    slider.className = 'sidebar-slider';
    slider.addEventListener('input', async () => {
      const v = parseFloat(slider.value);
      gmState.ambience[key].volume = v;
      AudioEngine.setAmbienceVolume(key, v);
      // Sync volume to server state
      await fetch('/api/ambience', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, active: true, volume: v }),
      });
    });

    const stopBtn = document.createElement('button');
    stopBtn.className = 'sidebar-stop';
    stopBtn.title = 'Stop this layer';
    stopBtn.textContent = '✕';
    stopBtn.addEventListener('click', async () => {
      gmState.ambience[key].active = false;
      await fetch('/api/ambience', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, active: false, volume: gmState.ambience[key].volume }),
      });
      await AudioEngine.applyState(buildAudioState());
      // Update the ambience tile
      const tile = document.querySelector(`.ambience-tile[data-key="${key}"]`);
      if (tile) tile.classList.remove('active');
      syncSidebar();
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(stopBtn);
    section.appendChild(row);
  });
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an audio state object suitable for AudioEngine.applyState().
 * @returns {Object}
 */
function buildAudioState() {
  return {
    music: gmState.music,
    ambience: gmState.ambience,
    fade: gmState.fade,
  };
}

/**
 * Initialise the Web Audio API on first user interaction (browser requirement).
 * Safe to call multiple times.
 */
function ensureAudio() {
  if (!audioStarted) {
    AudioEngine.init();
    AudioEngine.loadLibrary();
    audioStarted = true;
  }
}

// Bind track change events to update sidebar label
document.addEventListener('trackChanged', (e) => {
  const label = document.querySelector('#sidebar-music .sidebar-label');
  if (label) label.textContent = `${e.detail.playlist} — ${e.detail.track.replace(/\.[^.]+$/, '')}`;
});

// Boot
document.addEventListener('DOMContentLoaded', initGM);
