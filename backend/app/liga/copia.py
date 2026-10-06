"""Copia de seguridad del esquema `liga` (plan §14 y §8.5: el plan free de Supabase no tiene
copias diarias). `COPY … TO STDOUT` de cada tabla, en el mismo orden seguro por FK en que las creó
`sql/liga/00N_*.sql`, más un manifiesto JSON, todo en un único `.tar.gz` en memoria — el esquema
completo pesa 15-25 MB al año (plan §6.2), cabe de sobra. Abre su propia sesión de sistema: el
volcado necesita ver todas las filas, no las que la política de un rol dejaría (plan §7.4).
`backend/scripts/restaurar_liga.py` hace el camino inverso."""

from __future__ import annotations

import io
import json
import tarfile
from datetime import UTC, datetime

from app.liga.procesos.comun import auditar, fabrica_sistema

# Orden FK-safe: cada tabla solo depende de las anteriores de esta lista (o de `auth.users`,
# fuera del volcado — la restauración necesita usuarios ya creados). Ampliar aquí si una
# migración nueva añade una tabla; el orden de creación real está en `sql/liga/00N_*.sql`.
# Sin `permisos_rol`: es configuración sembrada por la propia migración (`liga_001`), no datos —
# volcarla la duplicaría al restaurar sobre un esquema recién migrado (su PK ya estaría puesta).
TABLAS = (
    "perfiles", "perfiles_privados", "roles_usuario", "planes_usuario", "pases_liga",
    "consentimientos", "temporadas", "jornadas", "estrategias", "recetas", "inscripciones",
    "posiciones", "resultados", "omega_operaciones", "ligas_privadas", "miembros_liga", "pruebas",
    "respuestas_ia", "lecturas", "creditos_movimientos", "ajustes", "auditoria", "reportes",
    "avisos_error", "borradores", "visitas", "estrategias_revisadas", "formaciones_degradadas",
    "suscripciones_push",
)

# El número más alto de `sql/liga/NNN_*.sql` aplicado (plan §6.3): se guarda en el manifiesto
# para saber, al restaurar, qué migraciones hacen falta antes de cargar los datos.
VERSION_ESQUEMA = 29


def _copiar_tabla(cursor, tabla: str) -> bytes:  # noqa: ANN001 — cursor de psycopg (DBAPI)
    buf = io.BytesIO()
    with cursor.copy(f"COPY liga.{tabla} TO STDOUT (FORMAT csv, HEADER true)") as copy:  # noqa: S608
        for trozo in copy:
            buf.write(bytes(trozo))
    return buf.getvalue()


def _anadir(tar: tarfile.TarFile, nombre: str, datos: bytes) -> None:
    info = tarfile.TarInfo(name=nombre)
    info.size = len(datos)
    info.mtime = int(datetime.now(UTC).timestamp())
    tar.addfile(info, io.BytesIO(datos))


def generar(actor: str | None) -> bytes:
    """El `.tar.gz` entero, ya en memoria; audita la descarga en la misma sesión de sistema."""
    db = fabrica_sistema()
    try:
        crudo = db.connection().connection.dbapi_connection
        manifiesto = {
            "generado": datetime.now(UTC).isoformat(), "version_esquema": VERSION_ESQUEMA,
            "tablas": [],
        }
        salida = io.BytesIO()
        with tarfile.open(fileobj=salida, mode="w:gz") as tar:
            for tabla in TABLAS:
                with crudo.cursor() as cursor:
                    datos = _copiar_tabla(cursor, tabla)
                filas = max(0, datos.count(b"\n") - 1)  # sin contar la cabecera del CSV
                manifiesto["tablas"].append({"tabla": tabla, "filas": filas, "bytes": len(datos)})
                _anadir(tar, f"{tabla}.csv", datos)
            crudo_manifiesto = json.dumps(manifiesto, ensure_ascii=False, indent=2).encode("utf-8")
            _anadir(tar, "manifiesto.json", crudo_manifiesto)
        auditar(db, "copia.descargar", None,
               {"tablas": len(TABLAS), "bytes": salida.tell()}, actor)
        db.commit()
        return salida.getvalue()
    finally:
        db.close()
