"""
routes.py
---------
GM control endpoints: update music, ambience, fade settings, and push
the current soundscape state to all listeners.

All request and response bodies are typed with Pydantic models from models.py.
"""

from fastapi import APIRouter

from api import session_state
from api.models import (
    AmbienceResponse,
    FadeResponse,
    MusicResponse,
    PushResponse,
    SessionState,
    SetAmbienceRequest,
    SetFadeRequest,
    SetMusicRequest,
)

router = APIRouter(prefix="/api")


@router.post("/music", response_model=MusicResponse)
def set_music(req: SetMusicRequest) -> MusicResponse:
    """
    Update the active music playlist and optionally specify the starting track.
    Pass playlist=null to stop all music.
    """
    session_state.update_music(req.playlist, req.track, req.volume)
    return MusicResponse(ok=True, music=session_state.get_state().music)


@router.post("/ambience", response_model=AmbienceResponse)
def set_ambience(req: SetAmbienceRequest) -> AmbienceResponse:
    """
    Toggle or adjust a single ambience layer.
    If active=False the layer fades out on the client but remains in state
    so the GM sidebar can still show it.
    """
    session_state.update_ambience(req.key, req.active, req.volume)
    layer = session_state.get_state().ambience.get(req.key)
    return AmbienceResponse(ok=True, key=req.key, state=layer)


@router.delete("/ambience/{category}/{filename}")
def remove_ambience(category: str, filename: str) -> dict:
    """Remove an ambience layer from state entirely (stops and forgets it)."""
    key = f"{category}/{filename}"
    session_state.remove_ambience(key)
    return {"ok": True, "removed": key}


@router.post("/fade", response_model=FadeResponse)
def set_fade(req: SetFadeRequest) -> FadeResponse:
    """Update fade durations for music and/or ambience (in milliseconds)."""
    session_state.update_fade(req.music_ms, req.ambience_ms)
    return FadeResponse(ok=True, fade=session_state.get_state().fade)


@router.post("/push", response_model=PushResponse)
def push_state() -> PushResponse:
    """
    Commit the current GM soundscape and broadcast it to all listeners.
    Stamps the state with the current timestamp; listeners polling /api/state
    will detect the change via updated_at.
    """
    state = session_state.push_state()
    return PushResponse(ok=True, state=state)


@router.get("/gm-state", response_model=SessionState)
def get_gm_state() -> SessionState:
    """Return the full current state for the GM page (unpushed working state)."""
    return session_state.get_state()
