"""Sirve la web compilada y TODAS las rutas existentes de FastAPI desde un mismo origen.
Iniciar con: python -m uvicorn web_host:app --host 127.0.0.1 --port 8765
"""
import os
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse

from reconocimiento_local.server import app  # Importa el backend que YA tenés, sin sobrescribirlo

DIST = Path(os.environ.get('PIZARRA_FRONTEND_DIR', str(Path(__file__).resolve().parent / 'dist'))).resolve()
if not (DIST / "index.html").is_file():
    raise RuntimeError(f"No existe {DIST / 'index.html'}. Primero compilá el frontend en esa carpeta.")

@app.middleware("http")
async def pizarra_namespace(request, call_next):
    """Also support the standalone local UI with the same paths as Cursado."""
    path = request.scope["path"]
    if path in ("/", "/pizarra"):
        query = request.scope.get("query_string", b"").decode("ascii")
        return RedirectResponse("/pizarra/" + ("?" + query if query else ""), status_code=307)
    if path.startswith(("/pizarra/api/", "/pizarra/recognize/")) or path == "/pizarra/recognize":
        request.scope["path"] = path[len("/pizarra"):]
        request.scope["raw_path"] = request.scope["path"].encode("utf-8")
    return await call_next(request)


# Existing /api/ and /recognize/ routes remain the Python backend contract.
app.mount("/pizarra", StaticFiles(directory=str(DIST), html=True), name="frontend")
