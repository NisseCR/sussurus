"""
audio_scanner.py
----------------
Scans the /audio directory on disk and returns structured metadata
about available playlists and ambience categories.

Expected directory layout:
    audio/
        music/
            somber/         ← playlist folder (name = playlist name)
                track1.mp3
                cover.jpg   ← optional cover art (any image extension)
            hopeful/
                ...
        ambience/
            weather/        ← category folder
                rain.ogg
                wind.ogg
            interior/
                ...
"""

from pathlib import Path

from api.models import AudioLibrary, PlaylistInfo

# Root audio directory relative to the project root
AUDIO_ROOT = Path("audio")
MUSIC_ROOT = AUDIO_ROOT / "music"
AMBIENCE_ROOT = AUDIO_ROOT / "ambience"

MUSIC_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg"}
AMBIENCE_EXTENSIONS = {".ogg", ".wav", ".mp3"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def scan_playlists() -> list[PlaylistInfo]:
    """
    Scan the music directory and return a list of PlaylistInfo models.
    Each model contains the folder name, sorted track filenames, and an
    optional URL path to the first cover image found.
    """
    playlists: list[PlaylistInfo] = []

    if not MUSIC_ROOT.exists():
        return playlists

    for folder in sorted(MUSIC_ROOT.iterdir()):
        if not folder.is_dir():
            continue

        tracks: list[str] = []
        cover: str | None = None

        for file in sorted(folder.iterdir()):
            if file.suffix.lower() in MUSIC_EXTENSIONS:
                tracks.append(file.name)
            elif file.suffix.lower() in IMAGE_EXTENSIONS and cover is None:
                cover = f"/audio/music/{folder.name}/{file.name}"

        playlists.append(PlaylistInfo(name=folder.name, tracks=tracks, cover=cover))

    return playlists


def scan_ambience() -> dict[str, list[str]]:
    """
    Scan the ambience directory and return a dict mapping each category
    to a sorted list of filenames.

    Example:
        {"weather": ["rain.ogg", "wind.ogg"], "interior": ["fireplace.ogg"]}
    """
    categories: dict[str, list[str]] = {}

    if not AMBIENCE_ROOT.exists():
        return categories

    for folder in sorted(AMBIENCE_ROOT.iterdir()):
        if not folder.is_dir():
            continue

        files = [
            f.name
            for f in sorted(folder.iterdir())
            if f.suffix.lower() in AMBIENCE_EXTENSIONS
        ]

        if files:
            categories[folder.name] = files

    return categories


def scan_library() -> AudioLibrary:
    """
    Scan both the music and ambience directories and return a fully
    typed AudioLibrary model.
    """
    return AudioLibrary(
        playlists=scan_playlists(),
        ambience=scan_ambience(),
    )
