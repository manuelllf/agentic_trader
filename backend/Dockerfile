# Backend FastAPI · imagen basada en la oficial de uv (rápida y reproducible).
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# Bytecode precompilado y copia (mejor en contenedor que symlinks).
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Primero los metadatos para cachear la capa de dependencias.
COPY pyproject.toml uv.lock ./
COPY app ./app

# Instala EXACTAMENTE lo del lockfile (build reproducible), sin dev.
# --extra postgres: el driver psycopg va SIEMPRE en la imagen → cambiar de SQLite a
# Supabase/Postgres es solo cambiar DATABASE_URL, sin tocar el build.
RUN uv sync --frozen --no-dev --extra postgres --extra memory

# Usuario sin privilegios para el PROCESO de la app. Railway monta el volumen /data como
# root, así que el contenedor entra como root SOLO para chown-earlo y suelta privilegios
# con setpriv antes de arrancar uvicorn (setpriv viene en util-linux; el build falla aquí
# si un día la imagen base lo quitara).
RUN useradd --create-home --uid 10001 app && chown -R app:app /app && setpriv --version

EXPOSE 8000
# Forma shell (no exec) para que ${PORT} se expanda: Railway inyecta su propio puerto.
# El exec hace PID 1 a uvicorn, ya como usuario `app` (uid 10001, sin privilegios).
# HOME explícito: setpriv cambia el uid pero no el entorno (las cachés de yfinance y cía.
# van a /home/app). Uvicorn arranca DIRECTO del venv del build — uv no pinta nada en runtime.
CMD mkdir -p /data && chown -R app:app /data; \
    exec setpriv --reuid=app --regid=app --init-groups \
    env HOME=/home/app /app/.venv/bin/python -m uvicorn app.main:app \
    --host 0.0.0.0 --port ${PORT:-8000}
