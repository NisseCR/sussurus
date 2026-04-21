/**
 * listener.js
 * -----------
 * Logic for the listener page.
 * Handles:
 *   - Session code entry and validation
 *   - Long-polling the server for state updates
 *   - Handing state snapshots to the AudioEngine
 *   - Showing currently playing information
 */

/** The session code the listener used to join. */
let sessionCode = null;

/** The timestamp of the last state the listener received and applied. */
let lastUpdatedAt = 0;

/** Whether the audio context has been started (requires user gesture). */
let audioStarted = false;

/** Whether polling is currently active. */
let pollingActive = false;


// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Entry point — called on DOMContentLoaded.
 * Shows the join form; audio doesn't start until the user interacts.
 */
function initListener() {
  setupJoinForm();
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

  // Start audio (this IS the user gesture since it comes from the form submit chain)
  AudioEngine.init();
  AudioEngine.loadLibrary().then(() => {
    AudioEngine.applyState(state);
    audioStarted = true;
  });

  updateNowPlaying(state);
  startPolling();
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
        if (audioStarted) AudioEngine.applyState(state);
        updateNowPlaying(state);
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
