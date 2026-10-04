"""Copia y restauración del esquema `liga` (plan §8.5): vuelca la BD de pruebas con filas
sembradas, restaura en una BD nueva del mismo contenedor Docker (`liga-pg`) y compara filas por
tabla. Nunca toca producción: la BD nueva vive en el mismo contenedor de pruebas, con un nombre
propio, y se borra al final.

`pg_dump`/`psql`/`createdb`/`dropdb` no hacen falta en el host: se ejecutan DENTRO del contenedor
(`docker exec`, como el propio Postgres de pruebas) — si `docker` no está disponible o el
contenedor no corre, se salta."""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

psycopg = pytest.importorskip("psycopg")

from app.liga import copia  # noqa: E402
from app.liga.copia import TABLAS  # noqa: E402

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
CONTENEDOR = os.environ.get("LIGA_TEST_DOCKER_CONTAINER", "liga-pg")


def _contenedor_disponible() -> bool:
    if not shutil.which("docker"):
        return False
    r = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", CONTENEDOR],
                       capture_output=True, text=True)
    return r.returncode == 0 and r.stdout.strip() == "true"


pytestmark = [
    pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)"),
    pytest.mark.skipif(not _contenedor_disponible(),
                       reason=f"El contenedor Docker «{CONTENEDOR}» no está corriendo"),
]
RAIZ_SQL = Path(__file__).resolve().parents[2] / "sql" / "liga"


def _url_con_bd(url: str, nombre_bd: str) -> str:
    partes = urlsplit(url)
    return urlunsplit((partes.scheme, partes.netloc, f"/{nombre_bd}", partes.query, ""))


def _en_contenedor(*args: str, entrada: str | None = None) -> str:
    """Un binario de cliente de Postgres DENTRO del contenedor (mismo Postgres que
    `LIGA_TEST_DATABASE_URL`, sin necesitar `pg_dump`/`psql`/`createdb` en el host)."""
    cmd = ["docker", "exec", "-i", "-e", "PGPASSWORD=localtest", "-e", "PGCLIENTENCODING=UTF8",
          CONTENEDOR, *args]
    r = subprocess.run(cmd, input=entrada, capture_output=True, text=True, encoding="utf-8",
                       check=False)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} falló: {r.stderr}")
    return r.stdout


@pytest.fixture
def bd_origen(monkeypatch):  # noqa: ANN001, ANN201
    """Filas de prueba en la BD de pruebas ya provisionada (schema `liga` completo, `auth` con
    su stub): se limpian al final, nunca se deja nada."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.db as app_db

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    monkeypatch.setattr(app_db, "SessionLocal", sessionmaker(bind=motor))

    cx = psycopg.connect(URL, autocommit=True)
    uid = uuid.uuid4()
    cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
              (uid, f"{uid.hex[:12]}@prueba.local"))
    # El disparador `liga_alta_usuario` ya crea el perfil (y el rol) al insertar en `auth.users`.
    try:
        yield cx, uid
    finally:
        cx.execute("delete from liga.perfiles where id = %s", (uid,))
        cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()


def test_copia_restaura_con_las_mismas_filas_por_tabla(bd_origen, tmp_path) -> None:  # noqa: ANN001
    cx_origen, uid = bd_origen

    # Contadas ANTES de generar la copia: `copia.generar` audita su propia descarga en
    # `liga.auditoria` al terminar, así que esa fila nunca sale en el propio volcado.
    filas_origen = {t: cx_origen.execute(f"select count(*) from liga.{t}").fetchone()[0]  # noqa: S608
                    for t in TABLAS}

    contenido = copia.generar(actor=None)
    archivo = tmp_path / "copia.tar.gz"
    archivo.write_bytes(contenido)

    bd_nueva = f"liga_restore_test_{uuid.uuid4().hex[:8]}"
    _en_contenedor("createdb", "-U", "postgres", bd_nueva)
    destino_url = _url_con_bd(URL, bd_nueva)
    try:
        # `auth` con su stub, clonado de la BD de pruebas (mismo contenido en cualquier entorno
        # que ya corra la batería de RLS contra `liga-pg`) — nunca de producción. Se quita el
        # disparador `liga_alta_usuario`: lo vuelve a poner `liga_001` sobre este mismo
        # `auth.users`, igual que en el primer despliegue real (el esquema `auth` es anterior).
        volcado_auth = _en_contenedor("pg_dump", "-U", "postgres", "-d", "postgres",
                                      "--schema=auth", "--no-owner", "--no-privileges")
        volcado_auth = "\n".join(
            linea for linea in volcado_auth.splitlines() if "EXECUTE FUNCTION liga." not in linea)
        _en_contenedor("psql", "-U", "postgres", "-d", bd_nueva, "-v", "ON_ERROR_STOP=1",
                       entrada=volcado_auth)
        for numero in range(1, copia.VERSION_ESQUEMA + 1):
            for f in sorted(RAIZ_SQL.glob(f"{numero:03d}_*.sql")):
                _en_contenedor("psql", "-U", "postgres", "-d", bd_nueva, "-v", "ON_ERROR_STOP=1",
                               entrada=f.read_text(encoding="utf-8"))

        from scripts.restaurar_liga import restaurar
        restaurar(archivo, destino_url)

        with psycopg.connect(destino_url) as cx_nueva:
            for tabla in TABLAS:
                n = cx_nueva.execute(f"select count(*) from liga.{tabla}").fetchone()[0]  # noqa: S608
                assert n == filas_origen[tabla], f"{tabla}: {n} != {filas_origen[tabla]}"
    finally:
        _en_contenedor("dropdb", "-U", "postgres", "--if-exists", bd_nueva)
