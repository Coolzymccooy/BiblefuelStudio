"""
Chatterbox HTTP wrapper for BibleFuel Studio.

Implements the wire contract the biblefuel voice/ provider expects:

    POST /tts
      request JSON: {
        "text": str,
        "audio_prompt_path": str | null,
        "exaggeration": float | null,
        "cfg_weight": float | null,
        "output_format": "wav" | "mp3"   # provider sends "mp3" but server emits WAV
      }
      response: audio bytes (Content-Type: audio/wav)

Notes
-----
* The biblefuel provider accepts either raw audio bytes OR JSON with
  audio_base64. We return raw WAV bytes — fastest path, smallest code.
* Chatterbox emits a 24kHz WAV. The biblefuel provider writes the
  response to a .mp3 path but doesn't actually transcode; ffmpeg in the
  render pipeline accepts either container.
* Model is loaded once at startup. First request after boot pays no
  extra cost; the model load itself happens during uvicorn startup.
* On Windows + AMD GPU, CUDA is unavailable. Device falls back to CPU.
  Synthesis on CPU is slow (~1–2 minutes for a short sentence).
"""

from __future__ import annotations

import io
import logging
import os
import re
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import soundfile as sf
import torch
from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from pydantic import BaseModel

logger = logging.getLogger("chatterbox-server")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def pick_device() -> str:
    explicit = os.environ.get("CHATTERBOX_DEVICE", "").strip().lower()
    if explicit in {"cpu", "cuda", "mps"}:
        return explicit
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class TTSRequest(BaseModel):
    text: str
    audio_prompt_path: Optional[str] = None
    exaggeration: Optional[float] = None
    cfg_weight: Optional[float] = None
    output_format: Optional[str] = "wav"


class _State:
    model = None
    device: str = "cpu"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from chatterbox.tts import ChatterboxTTS

    device = pick_device()
    _State.device = device
    logger.info("Loading Chatterbox model on device=%s (this can take a few minutes)...", device)
    _State.model = ChatterboxTTS.from_pretrained(device=device)
    logger.info("Chatterbox model ready.")
    yield
    _State.model = None


app = FastAPI(title="BibleFuel Chatterbox bridge", lifespan=lifespan)


# Storage dir for uploaded reference voices. Defaults to ./voices/ relative
# to the server's cwd. Override via env so containerised deploys can write
# to a persistent volume (e.g. /data/voices).
VOICES_DIR = Path(os.environ.get("CHATTERBOX_VOICES_DIR", "voices")).resolve()
ALLOWED_AUDIO_EXT = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".webm"}
MAX_UPLOAD_BYTES = int(os.environ.get("CHATTERBOX_MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))


def _safe_voice_filename(original: str) -> str:
    """Strip path traversal, keep the extension, prepend a uuid."""
    base = os.path.basename(original or "voice.wav")
    ext = os.path.splitext(base)[1].lower()
    if ext not in ALLOWED_AUDIO_EXT:
        ext = ".wav"
    stem = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.splitext(base)[0]).strip("._-") or "voice"
    return f"{stem[:48]}-{uuid.uuid4().hex[:12]}{ext}"


@app.get("/health")
def health():
    return {
        "ok": True,
        "device": _State.device,
        "model_loaded": _State.model is not None,
    }


@app.post("/tts")
def tts(req: TTSRequest):
    if _State.model is None:
        raise HTTPException(status_code=503, detail="model not loaded yet")
    text = (req.text or "").strip()
    if len(text) < 3:
        raise HTTPException(status_code=400, detail="text required (min 3 chars)")

    kwargs = {}
    if req.audio_prompt_path:
        kwargs["audio_prompt_path"] = req.audio_prompt_path
    if req.exaggeration is not None:
        kwargs["exaggeration"] = float(req.exaggeration)
    if req.cfg_weight is not None:
        kwargs["cfg_weight"] = float(req.cfg_weight)

    try:
        wav_tensor = _State.model.generate(text, **kwargs)
    except Exception as exc:
        logger.exception("Chatterbox generate failed")
        raise HTTPException(status_code=500, detail=f"chatterbox generate failed: {exc}") from exc

    sample_rate = getattr(_State.model, "sr", 24000)
    audio = wav_tensor.squeeze().detach().cpu().numpy()

    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    return Response(content=buf.getvalue(), media_type="audio/wav")


@app.post("/upload")
async def upload_voice(file: UploadFile = File(...)):
    """
    Accept a reference voice sample and persist it on this host.

    Returns the absolute path the caller can later pass back to /tts as
    `audio_prompt_path`. Biblefuel uses this for voice-cloning via Chatterbox:
    Biblefuel POSTs the sample once, stores the returned path as the cloned
    voice's "id", then sends that id with every synth request.
    """
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="file is required")

    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_voice_filename(file.filename)
    dest = VOICES_DIR / safe_name

    # Stream the upload to disk in chunks so we don't blow memory on large WAVs.
    bytes_written = 0
    chunk_size = 1024 * 1024
    try:
        with dest.open("wb") as fh:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"upload exceeds {MAX_UPLOAD_BYTES} bytes",
                    )
                fh.write(chunk)
    except HTTPException:
        try:
            dest.unlink(missing_ok=True)
        except Exception:
            pass
        raise
    finally:
        await file.close()

    if bytes_written < 2048:
        try:
            dest.unlink(missing_ok=True)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail="upload too small (need >= 2KB of audio)")

    return {
        "ok": True,
        "path": str(dest),
        "filename": safe_name,
        "bytes": bytes_written,
    }


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("CHATTERBOX_HOST", "127.0.0.1")
    port = int(os.environ.get("CHATTERBOX_PORT", "8000"))
    uvicorn.run("server:app", host=host, port=port, log_level="info")
