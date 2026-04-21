"""
audio_files.py
--------------
Endpoint that exposes the scanned audio library to the frontend.
The GM page calls this once on load to populate playlists and ambience panels.
"""

from fastapi import APIRouter

from api.audio_scanner import scan_library
from api.models import AudioLibrary

router = APIRouter(prefix="/api/audio")


@router.get("/library", response_model=AudioLibrary)
def get_library() -> AudioLibrary:
    """
    Scan the audio directory and return the full typed library.

    Response shape:
        {
            "playlists": [
                { "name": "somber", "tracks": ["01.mp3", ...], "cover": "/audio/..." },
                ...
            ],
            "ambience": {
                "weather": ["rain.ogg", "wind.ogg"],
                ...
            }
        }
    """
    return scan_library()
