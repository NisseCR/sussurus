/**
 * listener.js
 * -----------
 * Logic for the listener page.
 * Handles:
 *   - Session code entry and validation
 *   - Long-polling the server for state updates
 *   - Handing state snapshots to the AudioEngine
 *   - Showing currently playing information
 *   - Listener-only volume sliders
 */

/** The session code the listener used to join. */
let sessionCode = null;

/** The timestamp of the last state the listener received and applied. */
let lastUpdatedAt = 0;

/** Whether the audio context has been started (requires user gesture). */
let audioStarted = false;

/** Whether polling is currently active. */
let pollingActive = false;

/** Serialized audio update chain so rapid pushes cannot overlap. */
let audioUpdateQueue = Promise.resolve();

/** The initial state captured during join/startup, if any. */
let pendingInitialState = null;

/** Whether the listener has already requested audio readiness. */
let audioReadyPromise = null;

/** Listener-only volume defaults. */
const VOLUME_STORAGE_KEYS = {
  music: 'sussurus.listener.volume.music',
  ambience: 'sussurus.listener.volume.ambience',
};

/** Local master volume values for this listener. */
let listenerVolumes = {
  music: readStoredVolume('music', 1.0),
  ambience: readStoredVolume('ambience', 1.0),
};


// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Entry point — called on DOMContentLoaded.
 * Shows the join form; audio doesn't start until the user interacts.
 */
function initListener() {
  setupJoinForm();
  setupVolumeControls();
  applyStoredVolumesToUI();
}


// ---------------------------------------------------------------------------
// Local volume persistence
// ---------------------------------------------------------------------------

/**
 * Read a stored listener volume from localStorage.
 * @param {string} type
 * @param {number} fallback
 * @returns {number}
 */
function readStoredVolume(type, fallback) {
  const raw = localStorage.getItem(VOLUME_STORAGE_KEYS[type]);
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

/**
 * Save a listener volume to localStorage.
 * @param {string} type
 * @param {number} value
 */
function saveStoredVolume(type, value) {
  localStorage.setItem(VOLUME_STORAGE_KEYS[type], String(value));
}

/**
 * Apply stored slider values to the UI.
 */
function applyStoredVolumesToUI() {
  const musicSlider = document.getElementById('music-volume-slider');
  const ambienceSlider = document.getElementById('ambience-volume-slider');

  if (musicSlider) {
    musicSlider.value = String(listenerVolumes.music);
  }

  if (ambienceSlider) {
    ambienceSlider.value = String(listenerVolumes.ambience);
  }

  updateVolumeValueLabels();
}

/**
 * Update the percentage labels beside the sliders.
 */
function updateVolumeValueLabels() {
  const musicValue = document.getElementById('music-volume-value');
  const ambienceValue = document.getElementById('ambience-volume-value');

  if (musicValue) {
    musicValue.textContent = `${Math.round(listenerVolumes.music * 100)}%`;
  }

  if (ambienceValue) {
    ambienceValue.textContent = `${Math.round(listenerVolumes.ambience * 100)}%`;
  }
}

/**
 * Bind the listener volume controls.
 */
function setupVolumeControls() {
  const musicSlider = document.getElementById('music-volume-slider');
  const ambienceSlider = document.getElementById('ambience-volume-slider');

  if (musicSlider) {
    musicSlider.addEventListener('input', () => {
      const value = Number(musicSlider.value);
      listenerVolumes.music = value;
      saveStoredVolume('music', value);
      updateVolumeValueLabels();
      AudioEngine.setListenerVolume('music', value);
    });
  }

  if (ambienceSlider) {
    ambienceSlider.addEventListener('input', () => {
      const value = Number(ambienceSlider.value);
      listenerVolumes.ambience = value;
      saveStoredVolume('ambience', value);
      updateVolumeValueLabels();
      AudioEngine.setListenerVolume('ambience', value);
    });
  }
}


// ---------------------------------------------------------------------------
// Join flow
// ---------------------------------------------------------------------------

/**
 * Bind the session code form.
 * On submit, validates the code with the server and transitions to the player view.
 */
function setupJoinForm() {
  const form = document.getElementById('join-form');
  const input = document.getElementById('code-input');
  const errorEl = document.getElementById('join-error');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = input.value.trim().toUpperCase();
    if (!code) return;

    errorEl.textContent = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Joining…';

    try {
      const res = await fetch(`/api/session/join?code=${encodeURIComponent(code)}`);
      if (!res.ok) {
        errorEl.textContent = 'Invalid session code. Check with your GM.';
        btn.disabled = false;
        btn.textContent = 'Join Session';
        return;
      }

      const state = await res.json();
      sessionCode = code;
      lastUpdatedAt = state.updated_at ?? 0;

      transitionToPlayer(state);
    } catch (err) {
      errorEl.textContent = 'Could not connect to server.';
      btn.disabled = false;
      btn.textContent = 'Join Session';
    }
  });
}

/**
 * Hide the join screen, show the player screen, and start audio + polling.
 * @param {Object} state - The initial state snapshot from the server.
 */
function transitionToPlayer(state) {
  document.getElementById('join-screen').style.display = 'none';
  document.getElementById('player-screen').style.display = 'flex';

  pendingInitialState = state;
  AudioEngine.init();

  ensureAudioReady()
    .then(() => {
      if (pendingInitialState) {
        return enqueueAudioState(pendingInitialState);
      }
    })
    .then(() => {
      pendingInitialState = null;
      audioStarted = true;

      // Re-apply listener-local volume after first engine state is active.
      AudioEngine.setListenerVolume('music', listenerVolumes.music);
      AudioEngine.setListenerVolume('ambience', listenerVolumes.ambience);
    });

  updateNowPlaying(state);
  startPolling();
}

/**
 * Ensure the listener audio engine is ready before any playback is applied.
 * @returns {Promise<void>}
 */
async function ensureAudioReady() {
  if (!audioReadyPromise) {
    audioReadyPromise = (async () => {
      if (!audioStarted) {
        await AudioEngine.loadLibrary();
      }
    })();
  }

  await audioReadyPromise;
}

/**
 * Queue a state application so updates cannot race each other.
 * @param {Object} state
 * @returns {Promise<void>}
 */
function enqueueAudioState(state) {
  audioUpdateQueue = audioUpdateQueue
    .then(() => AudioEngine.applyState(state))
    .catch(() => {});
  return audioUpdateQueue;
}


// ---------------------------------------------------------------------------
// Long-polling
// ---------------------------------------------------------------------------

/**
 * Begin the long-poll loop.
 * Each request blocks on the server until a new state is available or 30 s elapses.
 * On receiving a response the audio engine is updated and the next poll begins.
 */
function startPolling() {
  if (pollingActive) return;
  pollingActive = true;
  poll();
}

/**
 * Single poll iteration.
 * Calls itself recursively to maintain a continuous polling loop.
 */
async function poll() {
  if (!pollingActive || !sessionCode) return;

  try {
    const url = `/api/state?since=${lastUpdatedAt}&code=${encodeURIComponent(sessionCode)}`;
    const res = await fetch(url);

    if (res.status === 403) {
      // Session ended or code became invalid
      stopPolling();
      showDisconnected('Session ended by GM.');
      return;
    }

    if (res.ok) {
      const state = await res.json();

      if (state.updated_at > lastUpdatedAt) {
        lastUpdatedAt = state.updated_at;
        updateNowPlaying(state);
        await ensureAudioReady();
        await enqueueAudioState(state);

        // Keep local master volumes applied after every server update.
        AudioEngine.setListenerVolume('music', listenerVolumes.music);
        AudioEngine.setListenerVolume('ambience', listenerVolumes.ambience);
      }
    }
  } catch (err) {
    // Network error — wait briefly then retry
    await sleep(3000);
  }

  // Schedule the next poll immediately (server-side blocking handles the delay)
  poll();
}

/** Stop the polling loop. */
function stopPolling() {
  pollingActive = false;
}

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ---------------------------------------------------------------------------
// Now playing display
// ---------------------------------------------------------------------------

/**
 * Update the "now playing" UI section from a state snapshot.
 * @param {Object} state
 */
function updateNowPlaying(state) {
  const musicEl = document.getElementById('now-playing-music');
  const ambienceEl = document.getElementById('now-playing-ambience');

  if (musicEl) {
    musicEl.textContent = state.music?.playlist
      ? `♪ ${state.music.playlist}`
      : 'No music';
  }

  if (ambienceEl) {
    const active = Object.entries(state.ambience ?? {})
      .filter(([, v]) => v.active)
      .map(([k]) => k.replace(/\.[^.]+$/, '').replace('/', ' · '));
    ambienceEl.textContent = active.length ? active.join('  •  ') : 'No ambience';
  }
}

/**
 * Show a disconnected message on the player screen.
 * @param {string} message
 */
function showDisconnected(message) {
  const el = document.getElementById('player-screen');
  if (!el) return;

  const notice = document.createElement('p');
  notice.className = 'disconnect-notice';
  notice.textContent = message;
  el.appendChild(notice);
}

// Track changes from audio engine
document.addEventListener('trackChanged', (e) => {
  const el = document.getElementById('now-playing-music');
  if (el && e.detail.playlist) {
    el.textContent = `♪ ${e.detail.playlist} — ${e.detail.track.replace(/\.[^.]+$/, '')}`;
  }
});

// Boot
document.addEventListener('DOMContentLoaded', initListener);