/**
 * audioEngine.js
 * --------------
 * Core Web Audio API engine shared by both the GM page and the listener page.
 * Manages music playback (playlist cycling) and multiple ambience loops,
 * with smooth fade-in / fade-out on every state change.
 *
 * Public API:
 *   AudioEngine.init()
 *   AudioEngine.loadLibrary()
 *   AudioEngine.applyState(state)   ← main entry point, call on every state update
 *   AudioEngine.setMusicVolume(v)
 *   AudioEngine.setAmbienceVolume(key, v)
 *   AudioEngine.stopAll()
 */

const AudioEngine = (() => {

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  /** @type {AudioContext|null} */
  let ctx = null;

  /** Promise that resolves once the shared audio library metadata has loaded. */
  let libraryPromise = null;

  /** Serialized state application chain to prevent overlapping state races. */
  let applyQueue = Promise.resolve();

  /**
   * Music channel: one GainNode per "slot" so we can crossfade.
   * @type {{ source: AudioBufferSourceNode|null, gain: GainNode|null, playlist: string|null, trackIndex: number }}
   */
  const music = { source: null, gain: null, playlist: null, trackIndex: 0, targetVolume: 1.0 };

  /**
   * Ambience layers keyed by "<category>/<filename>".
   * @type {Map<string, { source: AudioBufferSourceNode, gain: GainNode, targetVolume: number }>}
   */
  const ambienceLayers = new Map();

  /** Cache decoded AudioBuffers to avoid re-fetching. @type {Map<string, AudioBuffer>} */
  const bufferCache = new Map();

  /** Fade durations in seconds (updated from state). */
  const fade = { music: 5, ambience: 10 };

  /** Library snapshot: playlists & tracks loaded on init. */
  let library = { playlists: [], ambience: {} };


  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  /**
   * Must be called from a user gesture (click) to satisfy browser autoplay policy.
   * Creates the AudioContext if it doesn't exist yet.
   */
  function init() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
  }

  /**
   * Load the audio library metadata from the server.
   * Subsequent callers share the same in-flight request.
   * @returns {Promise<void>}
   */
  async function loadLibrary() {
    if (libraryPromise) return libraryPromise;

    libraryPromise = (async () => {
      const res = await fetch('/api/audio/library');
      library = await res.json();
    })();

    try {
      await libraryPromise;
    } finally {
      libraryPromise = null;
    }
  }

  /**
   * Ensure the library metadata is loaded before any playback attempt.
   * @returns {Promise<void>}
   */
  async function ensureReady() {
    if (!ctx) return;
    await loadLibrary();
  }


  // ---------------------------------------------------------------------------
  // Buffer loading
  // ---------------------------------------------------------------------------

  /**
   * Fetch and decode an audio file, using the cache to avoid duplicate requests.
   * @param {string} url - Server URL of the audio file.
   * @returns {Promise<AudioBuffer>}
   */
  async function loadBuffer(url) {
    if (bufferCache.has(url)) return bufferCache.get(url);
    const res = await fetch(url);
    const raw = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(raw);
    bufferCache.set(url, buffer);
    return buffer;
  }


  // ---------------------------------------------------------------------------
  // Fade helpers
  // ---------------------------------------------------------------------------

  /**
   * Linearly ramp a GainNode to zero over `durationSec` seconds,
   * then disconnect and return a promise that resolves when the fade completes.
   * @param {GainNode} gainNode
   * @param {number} durationSec
   * @returns {Promise<void>}
   */
  function fadeOut(gainNode, durationSec) {
    return new Promise(resolve => {
      const now = ctx.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, now + durationSec);
      setTimeout(resolve, durationSec * 1000);
    });
  }

  /**
   * Linearly ramp a GainNode from 0 to `targetVolume` over `durationSec` seconds.
   * @param {GainNode} gainNode
   * @param {number} targetVolume - Final gain value (0.0–1.0).
   * @param {number} durationSec
   */
  function fadeIn(gainNode, targetVolume, durationSec) {
    const now = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(targetVolume, now + durationSec);
  }

  /**
   * Smoothly ramp a GainNode to a new value without abrupt jumps.
   * Used for volume slider adjustments.
   * @param {GainNode} gainNode
   * @param {number} targetVolume
   * @param {number} rampSec - Short ramp to avoid clicks.
   */
  function rampVolume(gainNode, targetVolume, rampSec = 0.1) {
    const now = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(targetVolume, now + rampSec);
  }


  // ---------------------------------------------------------------------------
  // Music playback
  // ---------------------------------------------------------------------------

  /**
   * Start playing a specific track from a playlist.
   * Sets up an `onended` callback to advance to the next track automatically.
   * @param {string} playlistName
   * @param {number} trackIndex - Index into the playlist's track array.
   * @param {GainNode} gainNode - Pre-created gain node (already connected to destination).
   */
  async function startTrack(playlistName, trackIndex, gainNode) {
    const playlist = library.playlists.find(p => p.name === playlistName);
    if (!playlist || !playlist.tracks.length) return;

    const track = playlist.tracks[trackIndex % playlist.tracks.length];
    const url = `/audio/music/${playlistName}/${track}`;

    const buffer = await loadBuffer(url);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode);
    source.start(0);

    music.source = source;
    music.playlist = playlistName;
    music.trackIndex = trackIndex % playlist.tracks.length;

    // When this track ends, advance to the next one (if playlist unchanged)
    source.onended = () => {
      if (music.playlist === playlistName && music.source === source) {
        const nextIndex = (music.trackIndex + 1) % playlist.tracks.length;
        startTrack(playlistName, nextIndex, gainNode);
      }
    };

    // Notify UI about the current track
    document.dispatchEvent(new CustomEvent('trackChanged', {
      detail: { playlist: playlistName, track, index: music.trackIndex }
    }));
  }

  /**
   * Switch to a new playlist (or stop music if playlistName is null).
   * Fades out the current music, then fades in the new playlist.
   * @param {string|null} playlistName
   * @param {string|null} trackHint - Specific track filename to start (optional).
   */
  async function switchPlaylist(playlistName, trackHint = null, targetVolume = 1.0) {
    const fadeDur = fade.music;

    // Fade out existing music
    if (music.gain) {
      const oldGain = music.gain;
      const oldSource = music.source;
      music.gain = null;
      music.source = null;
      await fadeOut(oldGain, fadeDur);
      if (oldSource) try { oldSource.stop(); } catch (_) {}
      oldGain.disconnect();
    }

    if (!playlistName) return; // stop music, don't start new

    // Create fresh gain node and fade in
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.connect(ctx.destination);
    music.gain = gainNode;
    music.targetVolume = targetVolume;

    // Determine starting track index
    let trackIndex = 0;
    if (trackHint) {
      const playlist = library.playlists.find(p => p.name === playlistName);
      if (playlist) {
        const idx = playlist.tracks.indexOf(trackHint);
        if (idx >= 0) trackIndex = idx;
      }
    }

    await startTrack(playlistName, trackIndex, gainNode);
    fadeIn(gainNode, targetVolume, fadeDur);
  }


  // ---------------------------------------------------------------------------
  // Ambience playback
  // ---------------------------------------------------------------------------

  /**
   * Start looping a single ambience file and fade it in.
   * @param {string} key - "<category>/<filename>" identifier.
   * @param {number} targetVolume - Volume level 0.0–1.0.
   */
  async function startAmbienceLayer(key, targetVolume) {
    const [category, filename] = key.split('/');
    const url = `/audio/ambience/${category}/${filename}`;

    const buffer = await loadBuffer(url);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start(0);

    ambienceLayers.set(key, { source, gain: gainNode, targetVolume });
    fadeIn(gainNode, targetVolume, fade.ambience);
  }

  /**
   * Fade out and stop an ambience layer.
   * @param {string} key
   */
  async function stopAmbienceLayer(key) {
    const layer = ambienceLayers.get(key);
    if (!layer) return;
    ambienceLayers.delete(key); // remove before async work so re-entrant calls are safe
    await fadeOut(layer.gain, fade.ambience);
    try { layer.source.stop(); } catch (_) {}
    layer.gain.disconnect();
  }


  // ---------------------------------------------------------------------------
  // Main state applicator
  // ---------------------------------------------------------------------------

  /**
   * Apply a full state snapshot from the server.
   * Calls are serialized so rapid updates cannot race each other.
   *
   * @param {Object} state - The JSON state object from the server.
   */
  function applyState(state) {
    applyQueue = applyQueue.then(() => applyStateInternal(state));
    return applyQueue;
  }

  /**
   * Internal state application implementation.
   * @param {Object} state
   */
  async function applyStateInternal(state) {
    if (!ctx) return;
    await ensureReady();

    // Update fade durations (convert ms → seconds)
    if (state.fade) {
      fade.music = (state.fade.music_ms ?? 5000) / 1000;
      fade.ambience = (state.fade.ambience_ms ?? 10000) / 1000;
    }

    // --- Music ---
    const desiredPlaylist = state.music?.playlist ?? null;
    const desiredVolume   = state.music?.volume   ?? 1.0;

    if (desiredPlaylist !== music.playlist) {
      await switchPlaylist(desiredPlaylist, state.music?.track ?? null, desiredVolume);
    } else if (music.gain) {
      // Same playlist still playing — just ramp volume if it changed
      rampVolume(music.gain, desiredVolume);
      music.targetVolume = desiredVolume;
    } else if (desiredPlaylist) {
      // Recovery path: playlist should be playing, but no active node exists yet.
      await switchPlaylist(desiredPlaylist, state.music?.track ?? null, desiredVolume);
    }

    // --- Ambience ---
    const desiredAmbience = state.ambience ?? {};

    // Stop layers that are no longer active
    for (const [key] of ambienceLayers) {
      const desired = desiredAmbience[key];
      if (!desired || !desired.active) {
        await stopAmbienceLayer(key);
      }
    }

    // Start or adjust layers that should be playing
    for (const [key, layerState] of Object.entries(desiredAmbience)) {
      if (!layerState.active) continue;

      if (ambienceLayers.has(key)) {
        // Already playing — just update volume
        rampVolume(ambienceLayers.get(key).gain, layerState.volume);
        ambienceLayers.get(key).targetVolume = layerState.volume;
      } else {
        // New layer — start and fade in
        await startAmbienceLayer(key, layerState.volume);
      }
    }
  }


  // ---------------------------------------------------------------------------
  // Volume controls (for GM sidebar sliders)
  // ---------------------------------------------------------------------------

  /**
   * Immediately ramp the music volume to a new value.
   * @param {number} volume - 0.0–1.0
   */
  function setMusicVolume(volume) {
    if (music.gain) rampVolume(music.gain, volume);
  }

  /**
   * Immediately ramp a specific ambience layer's volume.
   * @param {string} key
   * @param {number} volume - 0.0–1.0
   */
  function setAmbienceVolume(key, volume) {
    const layer = ambienceLayers.get(key);
    if (layer) {
      rampVolume(layer.gain, volume);
      layer.targetVolume = volume;
    }
  }

  /**
   * Fade out and stop all audio immediately.
   * Used when the GM or listener navigates away or closes the session.
   */
  async function stopAll() {
    // Stop all ambience
    const keys = [...ambienceLayers.keys()];
    await Promise.all(keys.map(stopAmbienceLayer));

    // Stop music
    if (music.gain) {
      const g = music.gain;
      music.gain = null;
      music.source = null;
      music.playlist = null;
      await fadeOut(g, 1);
      g.disconnect();
    }
  }

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------
  return { init, loadLibrary, applyState, setMusicVolume, setAmbienceVolume, stopAll };

})();