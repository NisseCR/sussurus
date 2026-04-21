"""
models.py
---------
All Pydantic models for the D&D Audio Mixer.

Organised into three groups:
  - Audio library models  (read from disk, served to the frontend)
  - Session state models  (the live soundscape, shared between GM and listeners)
  - Request models        (validated request bodies for the GM API endpoints)
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Audio library models
# ---------------------------------------------------------------------------

class PlaylistInfo(BaseModel):
    """Metadata for a single music playlist folder."""

    name: str = Field(..., description="Folder name, used as the playlist identifier")
    tracks: list[str] = Field(default_factory=list, description="Sorted list of audio filenames")
    cover: str | None = Field(None, description="URL path to cover art image, if present")


class AudioLibrary(BaseModel):
    """Full audio library returned by /api/audio/library."""

    playlists: list[PlaylistInfo] = Field(default_factory=list)
    ambience: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Category name → sorted list of filenames, e.g. {'weather': ['rain.ogg']}",
    )


# ---------------------------------------------------------------------------
# Session state models
# ---------------------------------------------------------------------------

class MusicState(BaseModel):
    """State of the currently active music channel."""

    playlist: str | None = Field(None, description="Active playlist folder name, or None if stopped")
    track: str | None = Field(None, description="Current track filename")
    track_order: list[str] = Field(default_factory=list, description="Ordered track list for this session")
    volume: float = Field(1.0, ge=0.0, le=1.0, description="Master volume for the music channel")


class AmbienceLayerState(BaseModel):
    """State of a single ambience layer, keyed by '<category>/<filename>'."""

    active: bool = Field(..., description="Whether this layer is currently playing")
    volume: float = Field(1.0, ge=0.0, le=1.0, description="Volume for this layer (0.0–1.0)")


class FadeConfig(BaseModel):
    """Fade duration settings, in milliseconds."""

    music_ms: int = Field(5000, ge=0, description="Fade duration for music transitions")
    ambience_ms: int = Field(10000, ge=0, description="Fade duration for ambience toggle")


class SessionState(BaseModel):
    """
    Complete session state — the single source of truth pushed to listeners.
    This is serialised to JSON and sent verbatim to the listener page.
    """

    session_code: str = Field("", description="6-character code listeners use to join")
    music: MusicState = Field(default_factory=MusicState)
    ambience: dict[str, AmbienceLayerState] = Field(
        default_factory=dict,
        description="Ambience layers keyed by '<category>/<filename>'",
    )
    fade: FadeConfig = Field(default_factory=FadeConfig)
    updated_at: float = Field(0.0, description="Unix timestamp of the last push to listeners")


# ---------------------------------------------------------------------------
# Request models  (validated bodies for GM API endpoints)
# ---------------------------------------------------------------------------

class SetMusicRequest(BaseModel):
    """Request body for POST /api/music."""

    playlist: str | None = Field(None, description="Playlist folder name, or null to stop music")
    track: str | None = Field(None, description="Track filename to start from")
    track_order: list[str] = Field(default_factory=list, description="Ordered track list for this session")
    volume: float = Field(1.0, ge=0.0, le=1.0, description="Music channel volume (0.0–1.0)")


class SetAmbienceRequest(BaseModel):
    """Request body for POST /api/ambience."""

    key: str = Field(..., description="Layer key in the form '<category>/<filename>'")
    active: bool = Field(..., description="Whether this layer should be playing")
    volume: float = Field(1.0, ge=0.0, le=1.0, description="Layer volume (0.0–1.0)")

    @field_validator("key")
    @classmethod
    def key_must_contain_slash(cls, v: str) -> str:
        """Ensure the key is in '<category>/<filename>' format."""
        if "/" not in v:
            raise ValueError("key must be in the format '<category>/<filename>'")
        return v


class SetFadeRequest(BaseModel):
    """Request body for POST /api/fade."""

    music_ms: int | None = Field(None, ge=0, description="Music fade duration in ms (omit to leave unchanged)")
    ambience_ms: int | None = Field(None, ge=0, description="Ambience fade duration in ms (omit to leave unchanged)")


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class MusicResponse(BaseModel):
    """Response body for POST /api/music."""

    ok: bool
    music: MusicState


class AmbienceResponse(BaseModel):
    """Response body for POST /api/ambience."""

    ok: bool
    key: str
    state: AmbienceLayerState | None


class FadeResponse(BaseModel):
    """Response body for POST /api/fade."""

    ok: bool
    fade: FadeConfig


class PushResponse(BaseModel):
    """Response body for POST /api/push."""

    ok: bool
    state: SessionState


class SessionNewResponse(BaseModel):
    """Response body for POST /api/session/new."""

    session_code: str