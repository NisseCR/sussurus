"""
session.py
----------
Session lifecycle endpoints:
  - POST /api/session/new   → GM creates (or resets) a session, gets a code
  - GET  /api/session/join  → validate a session code (listener)
  - GET  /api/state         → long-poll endpoint listeners use to get updates
  - GET  /                  → serve GM page
  - GET  /listen            → serve listener page
"""

import asyncio
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from api import session_state
from api.models import SessionNewResponse, SessionState

router = APIRouter()

TEMPLATES_DIR = Path("templates")


# ---------------------------------------------------------------------------
# Page routes
# ---------------------------------------------------------------------------

@router.get("/", response_class=HTMLResponse)
async def gm_page() -> HTMLResponse:
    """Serve the GM mixing page."""
    return HTMLResponse((TEMPLATES_DIR / "gm.html").read_text())


@router.get("/listen", response_class=HTMLResponse)
async def listener_page() -> HTMLResponse:
    """Serve the listener page."""
    return HTMLResponse((TEMPLATES_DIR / "listener.html").read_text())


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

@router.post("/api/session/new", response_model=SessionNewResponse)
def new_session() -> SessionNewResponse:
    """
    Create a new session (or reset the existing one).
    Returns the session code that listeners use to join.
    Called by the GM at the start of a game session.
    """
    code = session_state.reset_session()
    return SessionNewResponse(session_code=code)


@router.get("/api/session/join", response_model=SessionState)
def join_session(code: str) -> SessionState:
    """
    Validate a session code supplied by a listener.
    Returns the current state so the listener can start playing immediately.
    Raises 404 if the code does not match the active session.
    """
    state = session_state.get_state()
    if state.session_code.upper() != code.strip().upper():
        raise HTTPException(status_code=404, detail="Invalid session code")
    return state


# ---------------------------------------------------------------------------
# State polling
# ---------------------------------------------------------------------------

@router.get("/api/state", response_model=SessionState)
async def get_state(since: float = 0.0, code: str = "") -> SessionState:
    """
    Long-poll endpoint for listeners.
    Blocks for up to 30 seconds, returning as soon as the state's updated_at
    timestamp is newer than `since`. If no update arrives within the timeout
    the current state is returned anyway so the client can re-poll.

    Params:
        since  – the updated_at timestamp the client last saw (float, Unix time)
        code   – session code, validated on every request
    """
    state = session_state.get_state()

    if code and state.session_code.upper() != code.strip().upper():
        raise HTTPException(status_code=403, detail="Invalid session code")

    if state.updated_at > since:
        return state

    # Hold the connection open until a push arrives or the timeout elapses
    deadline = time.time() + 30
    while time.time() < deadline:
        await asyncio.sleep(1)
        state = session_state.get_state()
        if state.updated_at > since:
            return state

    # Timeout — return unchanged state so the client immediately re-polls
    return state
