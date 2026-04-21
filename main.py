"""
D&D Audio Mixer - Main Application Entry Point
Starts the FastAPI server and registers all routers.
"""

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router as api_router
from api.session import router as session_router
from api.audio_files import router as audio_files_router

app = FastAPI(title="D&D Audio Mixer", version="1.0.0")

# Allow all origins for local prototype use
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files (CSS, JS, images)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Mount the audio library so browsers can fetch files directly
app.mount("/audio", StaticFiles(directory="audio"), name="audio")

# Register API routers
app.include_router(api_router)
app.include_router(session_router)
app.include_router(audio_files_router)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
