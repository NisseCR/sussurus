import json
from pathlib import Path


DEFAULT_CONFIG = {
    "fade": {
        "music_ms": 5000,
        "ambience_ms": 10000,
    }
}


def load_audio_config() -> dict:
    config_path = Path("config/audio_config.json")
    if not config_path.exists():
        return DEFAULT_CONFIG.copy()

    with config_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    fade = data.get("fade", {})
    return {
        "fade": {
            "music_ms": int(fade.get("music_ms", DEFAULT_CONFIG["fade"]["music_ms"])),
            "ambience_ms": int(fade.get("ambience_ms", DEFAULT_CONFIG["fade"]["ambience_ms"])),
        }
    }