# D&D Audio Mixer — Soundscape

A self-hosted ambient audio mixer for tabletop RPG sessions.
The GM mixes music and ambience locally; listeners connect via session code
and receive immersive, fade-based audio updates.

---

## Quick start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Add your audio files

```
audio/
  music/
    somber/
      01-track.mp3
      02-track.mp3
      cover.jpg        ← optional cover art (any image)
    hopeful/
      ...
  ambience/
    weather/
      rain.ogg
      wind.ogg
    interior/
      fireplace.ogg
```

- Music files: `.mp3` (or `.wav`, `.flac`, `.ogg`)
- Ambience files: `.ogg` (or `.wav`, `.mp3`) — should be seamlessly loopable
- Cover art: any image file inside the playlist folder (first one found is used)

### 3. Add your background image

Place your background artwork at:
```
static/img/background.jpg
```
(Any web image format works: `.jpg`, `.png`, `.webp`)
The image will be darkened automatically by the CSS.

### 4. Run the server

```bash
python main.py
```

The server starts at `http://0.0.0.0:8000`.

### 5. Open pages

| Page | URL |
|------|-----|
| GM mixer | `http://localhost:8000/` |
| Listener | `http://localhost:8000/listen` |

Listeners on your local network use your machine's IP:
`http://192.168.x.x:8000/listen`

---

## How to run a session

1. Open `http://localhost:8000/` in your browser.
2. Click **New Session** — note the 6-character session code shown in the header.
3. Share the code and your IP address with players. They go to `/listen` and enter the code.
4. Mix your soundscape using the playlist tiles and ambience toggles.
5. Adjust volumes in the sidebar on the right.
6. When ready, click **Push to Listeners** — your soundscape is sent to all connected players.

Listeners use long-polling: each listener holds an open connection to the server, which responds the instant you hit Push. The delay from push to listeners hearing the fade start is effectively just LAN latency (milliseconds). The 30-second figure is only the connection timeout — if no push arrives in 30 s the server returns the unchanged state so the client can re-open the connection. It has no effect on push responsiveness.

---

## Project structure

```
dnd-audio/
├── main.py                  ← FastAPI app entry point
├── requirements.txt
├── api/
│   ├── audio_files.py       ← /api/audio/library endpoint
│   ├── audio_scanner.py     ← disk scanner for playlists & ambience
│   ├── routes.py            ← GM control endpoints (music, ambience, fade, push)
│   ├── session.py           ← session lifecycle & long-poll endpoint
│   └── session_state.py     ← in-memory shared state
├── static/
│   ├── css/
│   │   ├── base.css         ← design tokens, reset, shared styles
│   │   ├── gm.css           ← GM page styles
│   │   └── listener.css     ← listener page styles
│   ├── js/
│   │   ├── audioEngine.js   ← Web Audio API engine (shared)
│   │   ├── gm.js            ← GM page UI logic
│   │   └── listener.js      ← listener page logic & long-poll
│   └── img/
│       └── background.jpg   ← your background art (place here)
├── templates/
│   ├── gm.html
│   └── listener.html
└── audio/
    ├── music/               ← playlist folders
    └── ambience/            ← category folders
```

---

## Configuration

Fade durations are controlled live in the GM page (no restart needed).
Defaults: **music 5 s**, **ambience 10 s**.

To expose to the internet (e.g. a VPS later), change `host` in `main.py` and
ensure port 8000 is open — no other changes required.
