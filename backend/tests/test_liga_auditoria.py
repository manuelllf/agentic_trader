"""El rastro (quién y cuándo) en cada tabla de `liga` (regla dura del dueño, ver
`backend/sql/liga/012_auditoria.sql`). El registro de abajo es la única fuente de verdad de qué
columnas le tocan a cada tabla; una tabla nueva que no se dé de alta aquí hace caer el primer test
-- así no se puede olvidar.
"""

from __future__ import annotations

import os

import pytest

psycopg = pytest.importorskip("psycopg")

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")

# tabla -> (columna creación, columna "quién creó" o None, columna actualización o None,
#           columna "quién actualizó" o None). None = no le corresponde, con el motivo al lado.
RASTRO = {
    "ajustes": ("creado", "creado_por", "actualizado", "actualizado_por"),
    "auditoria": ("creada", "actor_id", None, None),  # es su propia bitácora, solo_anadir
    "consentimientos": ("aceptado", "usuario_id", None, None),  # solo_anadir
    "creditos_movimientos": ("creado", "creado_por", None, None),  # solo_anadir
    "estrategias": ("creada", "creado_por", "actualizada", "actualizado_por"),
    "inscripciones": ("creado", "creado_por", "actualizado_en", "actualizado_por"),
    "jornadas": ("creado", "creado_por", "actualizado_en", "actualizado_por"),
    "lecturas": ("creada", "creado_por", None, None),  # de solo añadir, caché de IA
    "ligas_privadas": ("creada", "creado_por", "actualizado_en", "actualizado_por"),
    "miembros_liga": ("unido", "creado_por", None, None),  # solo insert/delete, nunca update
    "omega_operaciones": ("creado", "creado_por", "actualizado_en", "actualizado_por"),
    "perfiles": ("creado", "creado_por", "actualizado_en", "actualizado_por"),
    "perfiles_privados": ("creado", "creado_por", "actualizado_en", "actualizado_por"),
    "permisos_rol": (None, None, None, None),  # catálogo estático, solo lo toca una migración
    "planes_usuario": ("desde", "concedido_por", None, None),  # append-only
    "posiciones": (None, None, None, None),  # hija de inscripciones (FK inscripcion_id)
    "pruebas": ("creada", "usuario_id", "actualizado_en", "actualizado_por"),
    "recetas": ("creada", "creado_por", None, None),  # de solo añadir (nueva versión = nueva fila)
    "reportes": ("creado", "autor_id", "resuelto", "resuelto_por"),  # su única mutación real
    "respuestas_ia": ("creada", "creado_por", None, None),  # de solo añadir, caché de IA
    "resultados": (None, None, None, None),  # hija de inscripciones (solo_anadir)
    "roles_usuario": ("concedido", "creado_por", None, None),  # solo insert/delete
    "temporadas": ("creado", "creado_por", "actualizado_en", "actualizado_por"),
}


@pytest.fixture
def cx():
    conn = psycopg.connect(URL)
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


def _tablas(cx) -> set[str]:
    filas = cx.execute(
        "select table_name from information_schema.tables "
        "where table_schema = 'liga' and table_type = 'BASE TABLE'").fetchall()
    return {f[0] for f in filas}


def _columnas(cx, tabla: str) -> set[str]:
    filas = cx.execute(
        "select column_name from information_schema.columns "
        "where table_schema = 'liga' and table_name = %s", (tabla,)).fetchall()
    return {f[0] for f in filas}


def test_toda_tabla_de_liga_esta_clasificada(cx) -> None:
    """Una tabla nueva sin entrada en RASTRO hace caer este test primero: no se puede olvidar."""
    assert _tablas(cx) == set(RASTRO)


def test_toda_tabla_de_liga_entra_en_la_copia(cx) -> None:
    """Lo que no está en `copia.TABLAS` no se guarda en la copia de seguridad."""
    from app.liga.copia import TABLAS

    # `permisos_rol` es configuración sembrada por la propia migración, no datos.
    assert _tablas(cx) - {"permisos_rol"} == set(TABLAS)


@pytest.mark.parametrize("tabla", sorted(RASTRO))
def test_tabla_tiene_sus_columnas_de_rastro(cx, tabla: str) -> None:
    cols = _columnas(cx, tabla)
    for col in RASTRO[tabla]:
        if col is not None:
            assert col in cols, f"liga.{tabla} no tiene la columna «{col}»"


def test_tocar_auditoria_pone_actor_y_ahora_en_update() -> None:
    """`traza` (liga.tocar_auditoria) corriendo de verdad: sistema (postgres) -> actor null."""
    conn = psycopg.connect(URL)
    try:
        conn.execute("select set_config('request.jwt.claims', '', true)")
        conn.execute(
            "insert into liga.temporadas (nombre, n_jornadas, cuenta) "
            "values ('test-traza-auditoria', 1, false)")
        conn.execute(
            "update liga.temporadas set estado = 'en_juego' where nombre = 'test-traza-auditoria'")
        fila = conn.execute(
            "select creado_por, actualizado_en, actualizado_por from liga.temporadas "
            "where nombre = 'test-traza-auditoria'").fetchone()
        assert fila[0] is None  # nadie autenticado -> sistema
        assert fila[1] is not None  # actualizado_en sí se toca
        assert fila[2] is None
    finally:
        conn.rollback()
        conn.close()
