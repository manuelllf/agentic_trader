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
RUN uv sync --frozen --no-dev --extra postgres

EXPOSE 8000
# Forma shell (no exec) para que ${PORT} se expanda: Railway inyecta su propio puerto.
CMD uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
