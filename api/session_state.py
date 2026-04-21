"""
session_state.py
----------------
In-memory store for the current audio session state.
This is the single source of truth shared across all API routes.

The state is stored as a Pydantic ``SessionState`` instance, which means
every mutation is validated and the shape is always guaranteed to be correct.
"""

import time
import secrets
import random

from api.models import (
    AmbienceLayerState,
    FadeConfig,
    MusicState,
    SessionState,
)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_state: SessionState = SessionState()


# ---------------------------------------------------------------------------
# Accessors
# ---------------------------------------------------------------------------

def get_state() -> SessionState:
    """Return the current session state."""
    return _state


# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------

def reset_session() -> str:
    """
    Generate a fresh session code and reset all audio state to defaults.
    Returns the new session code.
    """
    global _state
    code = secrets.token_hex(3).upper()  # e.g. "A3F9C1"
    _state = SessionState(session_code=code, updated_at=time.time())
    return code


def update_music(
    playlist: str | None,
    track: str | None,
    track_order: list[str] | None = None,
    volume: float = 1.0,
) -> None:
    """Replace the music channel state with new values."""
    _state.music = MusicState(
        playlist=playlist,
        track=track,
        track_order=track_order or [],
        volume=volume,
    )


def shuffle_playlist_tracks(tracks: list[str]) -> list[str]:
    """Return a shuffled copy of the given track list."""
    shuffled = tracks[:]
    random.shuffle(shuffled)
    return shuffled


def update_ambience(key: str, active: bool, volume: float) -> None:
    """
    Set the state for a single ambience layer.
    Key format: "<category>/<filename>", e.g. "weather/rain.ogg".
    """
    _state.ambience[key] = AmbienceLayerState(active=active, volume=volume)


def remove_ambience(key: str) -> None:
    """Remove an ambience layer from state entirely."""
    _state.ambience.pop(key, None)


def update_fade(music_ms: int | None, ambience_ms: int | None) -> None:
    """Partially update fade durations, leaving unspecified fields unchanged."""
    _state.fade = FadeConfig(
        music_ms=music_ms if music_ms is not None else _state.fade.music_ms,
        ambience_ms=ambience_ms if ambience_ms is not None else _state.fade.ambience_ms,
    )


def push_state() -> SessionState:
    """
    Stamp the state with the current timestamp and return it.
    Called when the GM clicks 'Push to Listeners'.
    """
    _state.updated_at = time.time()
    return _state