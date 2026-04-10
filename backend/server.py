import argparse
import asyncio
import os
import shutil
import socket
import tempfile
import uuid
from typing import Optional

import uvicorn
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from converter import convert_to_vtp

app = FastAPI(title="Simulation Viewer Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory progress state: {file_id: {percent, message, done}}
progress_store: dict[str, dict] = {}

WORK_DIR: str = ""


def get_upload_dir() -> str:
    d = os.path.join(WORK_DIR, "uploads")
    os.makedirs(d, exist_ok=True)
    return d


def get_processed_dir() -> str:
    d = os.path.join(WORK_DIR, "processed")
    os.makedirs(d, exist_ok=True)
    return d


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/convert")
async def convert(
    file: UploadFile = File(...),
    x_file_id: Optional[str] = Header(default=None),
) -> dict:
    file_id = x_file_id if x_file_id else uuid.uuid4().hex
    original_name = file.filename or "upload"
    ext = os.path.splitext(original_name)[1].lower()

    allowed = {".vtk", ".vtu", ".vtp", ".mph"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    save_path = os.path.join(get_upload_dir(), f"{file_id}{ext}")

    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    progress_store[file_id] = {"percent": 0, "message": "Starting...", "done": False}

    def on_progress(percent: int, message: str) -> None:
        progress_store[file_id] = {
            "percent": percent,
            "message": message,
            "done": percent >= 100,
        }

    result = convert_to_vtp(file_id, save_path, get_processed_dir(), on_progress)
    result["file_id"] = file_id
    result["original_name"] = original_name
    return result


@app.get("/dataset/{file_id}")
def get_dataset(file_id: str) -> FileResponse:
    path = os.path.join(get_processed_dir(), f"{file_id}.vtp")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Dataset not found. File may not be processed yet.")
    return FileResponse(path, media_type="application/octet-stream")


@app.get("/progress/{file_id}")
async def get_progress(file_id: str) -> StreamingResponse:
    import json

    async def event_stream():
        while True:
            state = progress_store.get(
                file_id, {"percent": 0, "message": "Waiting...", "done": False}
            )
            payload = json.dumps({"percent": state["percent"], "message": state["message"]})
            yield f"data: {payload}\n\n"
            if state.get("done"):
                break
            await asyncio.sleep(0.3)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.delete("/file/{file_id}")
def delete_file(file_id: str) -> dict:
    removed: list[str] = []

    for d in [get_upload_dir(), get_processed_dir()]:
        for f in os.listdir(d):
            if f.startswith(file_id):
                try:
                    os.remove(os.path.join(d, f))
                    removed.append(f)
                except OSError:
                    pass

    progress_store.pop(file_id, None)
    return {"success": True, "removed": removed}


def find_free_port() -> int:
    s = socket.socket()
    s.bind(("", 0))
    port = s.getsockname()[1]
    s.close()
    return port


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Simulation Viewer Backend")
    parser.add_argument("--port", type=int, default=0, help="Port to listen on (0 = auto)")
    parser.add_argument(
        "--workdir",
        type=str,
        default=tempfile.mkdtemp(),
        help="Working directory for uploads and processed files",
    )
    args = parser.parse_args()

    WORK_DIR = args.workdir
    os.makedirs(WORK_DIR, exist_ok=True)

    port = args.port if args.port != 0 else find_free_port()

    # Signal to the extension that we are ready
    print(f"READY:{port}", flush=True)

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
