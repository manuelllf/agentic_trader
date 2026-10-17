from __future__ import annotations

import hashlib
import json
import os
import secrets
import uuid

import pytest

psycopg = pytest.importorskip("psycopg")

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Sin BD de pruebas de la liga (LIGA_TEST_DATABASE_URL)")


@pytest.fixture
def cx():
    conn = psycopg.connect(URL)
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


def _sistema(cx) -> None:
    cx.execute("reset role")
    cx.execute("select set_config('request.jwt.claims', '', true)")


def _como(cx, uid: uuid.UUID | None, aal: str = "aal1") -> None:
    _sistema(cx)
    if uid is None:
        cx.execute("set local role anon")
        return
    claims = json.dumps({"sub": str(uid), "role": "authenticated", "aal": aal})
    cx.execute("select set_config('request.jwt.claims', %s, true)", (claims,))
    cx.execute("set local role authenticated")


def _usuario(cx, rol: str | None = "usuario", pro: bool = False) -> uuid.UUID:
    """Alta como la haría Supabase Auth: el disparador crea perfil y rol `usuario`."""
    _sistema(cx)
    uid = uuid.uuid4()
    cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
               (uid, f"{uid.hex[:12]}@prueba.local"))
    if rol is None:
        cx.execute("delete from liga.roles_usuario where usuario_id = %s", (uid,))
    elif rol != "usuario":
        cx.execute("insert into liga.roles_usuario (usuario_id, rol) values (%s, %s)", (uid, rol))
    if pro:
        cx.execute("insert into liga.planes_usuario (usuario_id, plan, origen) "
                   "values (%s, 'pro', 'admin')", (uid,))
    return uid


def _falla(cx, sql: str, params: tuple | None = None) -> None:
    """La operación tiene que fallar (permiso, política o regla); no rompe la transacción."""
    with pytest.raises(psycopg.Error), cx.transaction():
        cx.execute(sql, params)


def _filas(cx, sql: str, params: tuple | None = None) -> list:
    return cx.execute(sql, params).fetchall()


def test_publico_solo_ve_lo_publicado(cx):
    _sistema(cx)
    publicado = cx.execute("insert into blog.articulos (slug, estado, publicado_en) "
                           "values ('publicado-prueba', 'publicado', now()) returning id").fetchone()[0]
    borrador = cx.execute("insert into blog.articulos (slug) values ('borrador-prueba') "
                          "returning id").fetchone()[0]
    for articulo in (publicado, borrador):
        for idioma in ('es', 'en'):
            cx.execute("insert into blog.articulo_textos (articulo_id, idioma) values (%s, %s)",
                       (articulo, idioma))
    _como(cx, None)
    assert _filas(cx, "select id from blog.articulos where id in (%s, %s)",
                  (publicado, borrador)) == [(publicado,)]
    assert _filas(cx, "select articulo_id, idioma from blog.articulo_textos "
                  "where articulo_id in (%s, %s) order by idioma", (publicado, borrador)) == [
                      (publicado, 'en'), (publicado, 'es')]


def test_publico_no_escribe_ni_lee_el_blog(cx):
    token = secrets.token_urlsafe(32)
    _como(cx, None)
    _falla(cx, "insert into blog.articulos (slug) values ('no-permitido')")
    _falla(cx, "update blog.articulo_textos set titulo = 'No permitido'")
    _falla(cx, "insert into blog.suscriptores (correo, idioma, hash_alta, alta_expira, token_baja) "
               "values ('persona@prueba.local', 'es', %s, now(), %s)",
           (hashlib.sha256(token.encode()).hexdigest(), secrets.token_urlsafe(32)))
    _falla(cx, "select * from blog.suscriptores")


def test_usuario_normal_no_administra_el_blog(cx):
    a = _usuario(cx)
    _sistema(cx)
    articulo = cx.execute("insert into blog.articulos (slug) values ('borrador-normal') "
                          "returning id").fetchone()[0]
    _como(cx, a)
    _falla(cx, "insert into blog.articulos (slug) values ('normal-no-puede')")
    assert _filas(cx, "select id from blog.articulos where id = %s", (articulo,)) == []


def test_admin_sin_2fa_no_administra(cx):
    adm = _usuario(cx, rol="admin")
    _sistema(cx)
    articulo = cx.execute("insert into blog.articulos (slug) values ('borrador-admin') "
                          "returning id").fetchone()[0]
    _como(cx, adm, aal="aal1")
    assert _filas(cx, "select id from blog.articulos where id = %s", (articulo,)) == []
    _falla(cx, "insert into blog.articulos (slug) values ('admin-sin-2fa')")
    _como(cx, adm, aal="aal2")
    nuevo = cx.execute("insert into blog.articulos (slug) values ('admin-con-2fa') "
                       "returning id").fetchone()[0]
    assert _filas(cx, "select id from blog.articulos where id = %s", (nuevo,)) == [(nuevo,)]


def test_auditoria_del_articulo(cx):
    adm = _usuario(cx, rol="admin")
    _sistema(cx)
    articulo = cx.execute("insert into blog.articulos (slug) values ('auditoria-prueba') "
                          "returning id").fetchone()[0]
    cx.execute("insert into blog.articulo_textos (articulo_id, idioma) values (%s, 'es')", (articulo,))
    _como(cx, adm, aal="aal2")
    cx.execute("update blog.articulo_textos set titulo = 'Nuevo título' where articulo_id = %s",
               (articulo,))
    assert _filas(cx, "select actualizado_en is not null, actualizado_por "
                  "from blog.articulo_textos where articulo_id = %s", (articulo,)) == [(True, adm)]


def test_boletin_alta_confirmacion_y_baja(cx):
    token1, token2 = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    h1, h2 = (hashlib.sha256(token.encode()).hexdigest() for token in (token1, token2))
    t1, t2 = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    consulta = "select * from blog.suscriptores where correo = 'persona@prueba.local'"
    _como(cx, None)
    assert _filas(cx, "select blog.suscribir('persona@prueba.local', 'es', %s, %s)", (h1, t1)) == [(True,)]
    _sistema(cx)
    assert _filas(cx, "select estado from blog.suscriptores where correo = 'persona@prueba.local'") == [('pendiente',)]
    _como(cx, None)
    assert _filas(cx, "select blog.suscribir('persona@prueba.local', 'es', %s, %s)", (h2, t2)) == [(True,)]
    _sistema(cx)
    assert _filas(cx, "select estado, hash_alta from blog.suscriptores "
                  "where correo = 'persona@prueba.local'") == [('pendiente', h2)]
    _como(cx, None)
    assert _filas(cx, "select blog.confirmar(%s)", (h1,)) == [(False,)]
    assert _filas(cx, "select blog.confirmar(%s)", (h2,)) == [(True,)]
    _sistema(cx)
    assert _filas(cx, "select estado, hash_alta, alta_expira, confirmado_en is not null "
                  "from blog.suscriptores where correo = 'persona@prueba.local'") == [('confirmado', None, None, True)]
    antes = _filas(cx, consulta)
    _como(cx, None)
    assert _filas(cx, "select blog.suscribir('persona@prueba.local', 'en', %s, %s)", (h1, t1)) == [(False,)]
    _sistema(cx)
    assert _filas(cx, consulta) == antes
    _como(cx, None)
    assert _filas(cx, "select blog.dar_de_baja(%s)", (t2,)) == [(True,)]
    _sistema(cx)
    assert _filas(cx, "select estado, baja_en is not null from blog.suscriptores "
                  "where correo = 'persona@prueba.local'") == [('baja', True)]
    antes = _filas(cx, consulta)
    _como(cx, None)
    assert _filas(cx, "select blog.dar_de_baja(%s)", (t2,)) == [(True,)]
    assert _filas(cx, "select blog.dar_de_baja('otro-token')") == [(False,)]
    _sistema(cx)
    assert _filas(cx, consulta) == antes


def test_boletin_enlace_caducado(cx):
    token = secrets.token_urlsafe(32)
    h = hashlib.sha256(token.encode()).hexdigest()
    _como(cx, None)
    assert _filas(cx, "select blog.suscribir('caducado@prueba.local', 'es', %s, %s)",
                  (h, secrets.token_urlsafe(32))) == [(True,)]
    _sistema(cx)
    cx.execute("update blog.suscriptores set alta_expira = now() - interval '1 minute' "
               "where hash_alta = %s", (h,))
    _como(cx, None)
    assert _filas(cx, "select blog.confirmar(%s)", (h,)) == [(False,)]
    _sistema(cx)
    assert _filas(cx, "select estado from blog.suscriptores where hash_alta = %s", (h,)) == [('pendiente',)]


def test_correo_en_minusculas(cx):
    token = secrets.token_urlsafe(32)
    _como(cx, None)
    _falla(cx, "select blog.suscribir('Persona@prueba.local', 'es', %s, %s)",
           (hashlib.sha256(token.encode()).hexdigest(), secrets.token_urlsafe(32)))


def test_auditoria_en_cada_tabla_del_blog(cx):
    _sistema(cx)
    for tabla in ('articulos', 'articulo_textos', 'suscriptores', 'envios', 'entregas'):
        columnas = {fila[0] for fila in _filas(cx, "select column_name from information_schema.columns "
                                             "where table_schema = 'blog' and table_name = %s", (tabla,))}
        assert {'creado', 'creado_por', 'actualizado_en', 'actualizado_por'} <= columnas
