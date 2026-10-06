"""RLS de la liga, persona a persona (plan §7.5). Contra un Postgres con el esquema de producción y
`backend/sql/liga/*` aplicado (la copia local en Docker): cada test corre en una transacción que se
deshace al final, así que no deja nada. Sin `LIGA_TEST_DATABASE_URL`, se salta.

Cada persona entra como en el backend: `SET LOCAL ROLE anon|authenticated` + los claims del JWT en
`request.jwt.claims`. El sistema es `postgres` (dueño, BYPASSRLS).
"""

from __future__ import annotations

import json
import os
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


# ---- personas ----------------------------------------------------------------------------------

def _sistema(cx) -> None:
    cx.execute("reset role")
    cx.execute("select set_config('request.jwt.claims', '', true)")


def test_registro_mvp_confirmado_conserva_alias_consentimientos_y_bienvenida(cx):
    _sistema(cx)
    cx.execute("insert into liga.ajustes (clave, valor) values ('liga.registro.abierto', 'true') "
               "on conflict (clave) do update set valor = excluded.valor")
    cx.execute("insert into liga.ajustes (clave, valor) values ('creditos.bienvenida', '15') "
               "on conflict (clave) do update set valor = excluded.valor")
    uid = uuid.uuid4()
    alias = "mvp_" + uid.hex[:10]
    cx.execute("insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) "
               "values (%s, %s, now(), %s)",
               (uid, f"{uid.hex}@prueba.local", json.dumps({"alias": alias, "terminos_version": "1"})))
    assert _filas(cx, "select alias from liga.perfiles where id = %s", (uid,)) == [(alias,)]
    assert _filas(cx, "select count(*) from liga.consentimientos where usuario_id = %s", (uid,)) == [(2,)]
    assert _filas(cx, "select rol::text from liga.roles_usuario where usuario_id = %s", (uid,)) == [("usuario",)]
    assert _filas(cx, "select count(*) from liga.creditos_movimientos where usuario_id = %s "
                 "and idempotencia = 'bienvenida'", (uid,)) == [(1,)]
    cx.execute("update auth.users set email_confirmed_at = now() where id = %s", (uid,))
    assert _filas(cx, "select count(*) from liga.creditos_movimientos where usuario_id = %s "
                 "and idempotencia = 'bienvenida'", (uid,)) == [(1,)]


def test_idioma_privado_solo_admite_es_en_y_no_modifica_otras_cuentas(cx):
    owner, other = _usuario(cx), _usuario(cx)
    _como(cx, owner)
    assert _filas(cx, "update liga.perfiles_privados set idioma = 'en' where id = %s returning idioma", (owner,)) == [("en",)]
    assert _filas(cx, "update liga.perfiles_privados set idioma = 'es' where id = %s returning id", (other,)) == []
    _falla(cx, "update liga.perfiles_privados set idioma = 'fr' where id = %s", (owner,))
    _sistema(cx)
    assert _filas(cx, "select idioma from liga.perfiles_privados where id = %s", (other,)) == [(None,)]


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


def _estrategia(cx, uid: uuid.UUID, nombre: str = "Mi estrategia") -> uuid.UUID:
    _como(cx, uid)
    return cx.execute(
        "insert into liga.estrategias (nombre, forma, dibujo, color1, color2) "
        "values (%s, 'escudo', 'liso', '#0B6E68', '#FFFFFF') returning id", (nombre,)).fetchone()[0]


UNA_REGLA = '[{"clave": "medianas", "params": {}}]'


def _receta(cx, uid: uuid.UUID, eid: uuid.UUID, pregunta: str | None = None,
            reglas: str = UNA_REGLA) -> int:
    _como(cx, uid)
    return cx.execute(
        "insert into liga.recetas (estrategia_id, reglas, catalogo_version, pregunta, "
        "peso_negocio, peso_precio, peso_deuda, peso_pronto, peso_pregunta, n_empresas, "
        "reparto, max_por_sector) values (%s, %s::jsonb, 1, %s, 30, 20, 20, 0, %s, 5, 'igual', 2) "
        "returning id", (eid, reglas, pregunta, 30 if pregunta else 0)).fetchone()[0]


def _lista(cx, uid: uuid.UUID, nombre: str = "Lista") -> tuple[uuid.UUID, int]:
    """Estrategia con receta, lista para apuntar."""
    eid = _estrategia(cx, uid, nombre)
    rid = _receta(cx, uid, eid)
    cx.execute("update liga.estrategias set receta_id = %s where id = %s", (rid, eid))
    return eid, rid


# ---- identidad y alta ----------------------------------------------------------------------------

def test_el_alta_crea_perfil_privado_y_rol(cx):
    a = _usuario(cx)
    _sistema(cx)
    assert _filas(cx, "select rol::text from liga.roles_usuario where usuario_id = %s", (a,)) == \
        [("usuario",)]
    alias = _filas(cx, "select alias from liga.perfiles where id = %s", (a,))[0][0]
    assert alias.startswith("jugador_") and len(alias) == 20
    assert _filas(cx, "select tema from liga.perfiles_privados where id = %s", (a,)) == [("auto",)]


def test_cada_uno_ve_su_perfil_privado_y_nadie_el_ajeno(cx):
    a, b = _usuario(cx), _usuario(cx)
    _como(cx, a)
    assert [r[0] for r in _filas(cx, "select id from liga.perfiles_privados")] == [a]
    _como(cx, None)
    _falla(cx, "select * from liga.perfiles_privados")
    _como(cx, b)
    assert _filas(cx, "select id from liga.perfiles_privados where id = %s", (a,)) == []


def test_el_alias_lo_cambia_su_dueno_y_ocultar_es_de_moderacion(cx):
    a, b, m = _usuario(cx), _usuario(cx), _usuario(cx, rol="moderador")
    _como(cx, a)
    cx.execute("update liga.perfiles set alias = 'la_de_a' where id = %s", (a,))
    _falla(cx, "update liga.perfiles set oculto = true where id = %s", (a,))
    _como(cx, b)
    assert cx.execute("update liga.perfiles set alias = 'robado' where id = %s",
                      (a,)).rowcount == 0
    _como(cx, m)
    _falla(cx, "update liga.perfiles set alias = 'por_mod' where id = %s", (a,))
    assert cx.execute("update liga.perfiles set oculto = true where id = %s", (a,)).rowcount == 1
    _como(cx, None)
    assert _filas(cx, "select 1 from liga.perfiles where id = %s", (a,)) == []


def test_alias_reservado_o_con_mayusculas_no_entra(cx):
    a = _usuario(cx)
    _como(cx, a)
    _falla(cx, "update liga.perfiles set alias = 'alpha' where id = %s", (a,))
    _falla(cx, "update liga.perfiles set alias = 'Mayus' where id = %s", (a,))
    _falla(cx, "update liga.perfiles set alias = 'admin' where id = %s", (a,))
    jefe = _usuario(cx, rol="admin")
    _como(cx, jefe, aal="aal2")
    assert cx.execute("update liga.perfiles set alias = 'admin' where id = %s",
                      (jefe,)).rowcount == 1


def test_nadie_se_da_roles_ni_planes(cx):
    a = _usuario(cx)
    _como(cx, a)
    _falla(cx, "insert into liga.roles_usuario (usuario_id, rol) values (%s, 'admin')", (a,))
    _falla(cx, "insert into liga.planes_usuario (usuario_id, origen) values (%s, 'admin')", (a,))
    assert [r[0] for r in _filas(cx, "select rol::text from liga.roles_usuario")] == ["usuario"]


def test_consentimientos_se_apuntan_y_no_se_tocan(cx):
    a = _usuario(cx)
    _como(cx, a)
    cx.execute("insert into liga.consentimientos (documento, version) values ('terminos', '1')")
    _falla(cx, "update liga.consentimientos set version = '2'")
    _falla(cx, "delete from liga.consentimientos")


# ---- estrategias y recetas
# -------------------------------------------------------------------------

def test_el_borrador_es_solo_de_su_dueno(cx):
    a, b = _usuario(cx), _usuario(cx)
    eid = _estrategia(cx, a)
    _como(cx, a)
    assert _filas(cx, "select dueno_id, estado from liga.estrategias where id = %s", (eid,)) == \
        [(a, "borrador")]
    _como(cx, b)
    assert _filas(cx, "select 1 from liga.estrategias where id = %s", (eid,)) == []
    _como(cx, None)
    assert _filas(cx, "select 1 from liga.estrategias where id = %s", (eid,)) == []


def test_nadie_elige_el_dueno_ni_el_tipo(cx):
    a, b = _usuario(cx), _usuario(cx)
    _como(cx, a)
    _falla(cx, "insert into liga.estrategias (dueno_id, nombre, forma, dibujo, color1, color2) "
               "values (%s, 'x', 'escudo', 'liso', '#000000', '#FFFFFF')", (b,))
    _falla(cx, "insert into liga.estrategias (tipo, nombre, forma, dibujo, color1, color2) "
               "values ('casa', 'x', 'escudo', 'liso', '#000000', '#FFFFFF')")


def test_la_receta_va_a_una_estrategia_tuya(cx):
    a, b = _usuario(cx), _usuario(cx)
    eid = _estrategia(cx, a)
    _como(cx, b)
    _falla(cx, "insert into liga.recetas (estrategia_id, catalogo_version, peso_negocio, "
               "peso_precio, peso_deuda, peso_pronto, peso_pregunta, n_empresas, reparto, "
               "max_por_sector) values (%s, 1, 30, 20, 20, 0, 0, 5, 'igual', 2)", (eid,))


def test_las_recetas_no_se_editan(cx):
    a = _usuario(cx)
    eid, rid = _lista(cx, a)
    _como(cx, a)
    _falla(cx, "update liga.recetas set n_empresas = 3 where id = %s", (rid,))
    _sistema(cx)
    _falla(cx, "update liga.recetas set n_empresas = 3 where id = %s", (rid,))


def test_la_pregunta_propia_es_de_pro(cx):
    a, p = _usuario(cx), _usuario(cx, pro=True)
    ea = _estrategia(cx, a)
    _como(cx, a)
    with pytest.raises(psycopg.Error), cx.transaction():
        _receta(cx, a, ea, pregunta="¿Sus clientes siguen comprando?")
    ep = _estrategia(cx, p)
    _receta(cx, p, ep, pregunta="¿Sus clientes siguen comprando?")


def test_transiciones_de_estado_permitidas(cx):
    a = _usuario(cx)
    eid = _estrategia(cx, a)
    _como(cx, a)
    # sin receta
    _falla(cx, "update liga.estrategias set estado = 'apuntada' where id = %s", (eid,))
    rid = _receta(cx, a, eid)
    cx.execute("update liga.estrategias set receta_id = %s where id = %s", (rid, eid))
    cx.execute("update liga.estrategias set estado = 'apuntada' where id = %s", (eid,))
    _falla(cx, "update liga.estrategias set estado = 'jugando' where id = %s", (eid,))
    cx.execute("update liga.estrategias set estado = 'borrador' where id = %s", (eid,))
    _sistema(cx)
    cx.execute("update liga.estrategias set estado = 'jugando' where id = %s", (eid,))
    _como(cx, a)
    _falla(cx, "update liga.estrategias set estado = 'borrador' where id = %s", (eid,))
    cx.execute("update liga.estrategias set estado = 'retirada' where id = %s", (eid,))


def test_gratis_juega_una_y_pro_tres(cx):
    a, p = _usuario(cx), _usuario(cx, pro=True)
    primera, _ = _lista(cx, a, "Una")
    segunda, _ = _lista(cx, a, "Dos")
    _como(cx, a)
    cx.execute("update liga.estrategias set estado = 'apuntada' where id = %s", (primera,))
    _falla(cx, "update liga.estrategias set estado = 'apuntada' where id = %s", (segunda,))
    ids = [_lista(cx, p, f"P{i}")[0] for i in range(4)]
    _como(cx, p)
    for eid in ids[:3]:
        cx.execute("update liga.estrategias set estado = 'apuntada' where id = %s", (eid,))
    _falla(cx, "update liga.estrategias set estado = 'apuntada' where id = %s", (ids[3],))


def test_apuntar_exige_al_menos_una_regla(cx):
    a = _usuario(cx)
    eid = _estrategia(cx, a)
    sin_reglas = _receta(cx, a, eid, reglas="[]")
    cx.execute("update liga.estrategias set receta_id = %s where id = %s", (sin_reglas, eid))
    _falla(cx, "update liga.estrategias set estado = 'apuntada' where id = %s", (eid,))
    con_regla = _receta(cx, a, eid)
    cx.execute("update liga.estrategias set receta_id = %s where id = %s", (con_regla, eid))
    cx.execute("update liga.estrategias set estado = 'apuntada' where id = %s", (eid,))
    # Tampoco vale cambiar una apuntada a una versión sin reglas.
    otra_sin = _receta(cx, a, eid, reglas="[]")
    _falla(cx, "update liga.estrategias set receta_id = %s where id = %s", (otra_sin, eid))
    # Y volver a borrador sí se puede, con la que sea.
    cx.execute("update liga.estrategias set estado = 'borrador' where id = %s", (eid,))
    cx.execute("update liga.estrategias set receta_id = %s where id = %s", (otra_sin, eid))


def test_publicar_es_de_pro_y_exige_declarar(cx):
    a, p = _usuario(cx), _usuario(cx, pro=True)
    ea, ep = _estrategia(cx, a), _estrategia(cx, p)
    _como(cx, a)
    _falla(cx, "update liga.estrategias set visibilidad = 'publicada', declara_posiciones = 'no' "
               "where id = %s", (ea,))
    _como(cx, p)
    _falla(cx, "update liga.estrategias set visibilidad = 'publicada' where id = %s", (ep,))
    cx.execute("update liga.estrategias set visibilidad = 'publicada', declara_posiciones = 'no' "
               "where id = %s", (ep,))


def test_la_receta_publicada_la_ve_pro_y_no_gratis(cx):
    autor, pro, gratis = _usuario(cx, pro=True), _usuario(cx, pro=True), _usuario(cx)
    eid, rid = _lista(cx, autor)
    _como(cx, autor)
    cx.execute("update liga.estrategias set visibilidad = 'publicada', declara_posiciones = 'si',"
               " estado = 'apuntada' where id = %s", (eid,))
    _como(cx, pro)
    assert _filas(cx, "select id from liga.recetas where id = %s", (rid,)) == [(rid,)]
    _como(cx, gratis)
    assert _filas(cx, "select id from liga.recetas where id = %s", (rid,)) == []
    _como(cx, None)
    _falla(cx, "select id from liga.recetas")


def test_moderacion_oculta_pero_no_edita(cx):
    a, m = _usuario(cx), _usuario(cx, rol="moderador")
    eid, _ = _lista(cx, a)
    _como(cx, a)
    cx.execute("update liga.estrategias set estado = 'apuntada' where id = %s", (eid,))
    _falla(cx, "update liga.estrategias set oculta = true where id = %s", (eid,))
    _como(cx, m)
    _falla(cx, "update liga.estrategias set nombre = 'Otra' where id = %s", (eid,))
    assert cx.execute("update liga.estrategias set oculta = true where id = %s",
                      (eid,)).rowcount == 1
    _como(cx, None)
    assert _filas(cx, "select 1 from liga.estrategias where id = %s", (eid,)) == []


def test_suspendido_no_crea_nada(cx):
    s = _usuario(cx, rol=None)
    _como(cx, s)
    _falla(cx, "insert into liga.estrategias (nombre, forma, dibujo, color1, color2) "
               "values ('x', 'escudo', 'liso', '#000000', '#FFFFFF')")


def test_borrar_solo_borradores_propios(cx):
    a, b = _usuario(cx), _usuario(cx)
    eid, _ = _lista(cx, a)
    _como(cx, b)
    assert cx.execute("delete from liga.estrategias where id = %s", (eid,)).rowcount == 0
    _como(cx, a)
    assert cx.execute("delete from liga.estrategias where id = %s", (eid,)).rowcount == 1


# ---- jornadas, posiciones y resultados ---------------------------------------------------------

def _jornada(cx) -> int:
    _sistema(cx)
    tid = cx.execute("insert into liga.temporadas (nombre, n_jornadas, cuenta) "
                     "values ('Prueba', 12, true) returning id").fetchone()[0]
    return cx.execute(
        "insert into liga.jornadas (temporada_id, numero, dia_base, dia_inicio, dia_fin, "
        "cierre_inscripcion) values (%s, 1, '2027-01-01', '2027-01-04', '2027-01-29', "
        "'2027-01-01 23:59+01') returning id", (tid,)).fetchone()[0]


def _inscripcion(cx, jid: int, eid: uuid.UUID, rid: int, tickers: list[str]) -> int:
    _sistema(cx)
    iid = cx.execute("insert into liga.inscripciones (jornada_id, estrategia_id, receta_id, "
                     "estado) values (%s, %s, %s, 'formada') returning id",
                     (jid, eid, rid)).fetchone()[0]
    for t in tickers:
        cx.execute("insert into liga.posiciones (inscripcion_id, ticker, peso) values (%s, %s, 20)",
                   (iid, t))
    return iid


def test_la_jornada_solo_fija_la_foto_que_uso_el_escaneo(cx):
    jid = _jornada(cx)
    f1, f2 = (cx.execute("insert into public.foto (alcance, estado, fin) "
                         "values ('nasdaq', 'completa', now()) returning id").fetchone()[0]
              for _ in range(2))
    con_foto, sin_foto = (cx.execute(
        "insert into public.scan_runs (scan_at, decide, foto_id) values (now(), true, %s) "
        "returning id", (f,)).fetchone()[0] for f in (f1, None))
    fijar = "update liga.jornadas set foto_id = %s, scan_run_id = %s where id = %s"
    _falla(cx, fijar, (f2, con_foto, jid))        # el escaneo puntuó otra foto
    _falla(cx, fijar, (f1, sin_foto, jid))        # el escaneo no apunta a ninguna foto
    _falla(cx, fijar, (f1, None, jid))            # foto sin escaneo
    assert cx.execute(fijar, (f1, con_foto, jid)).rowcount == 1
    # Ya fijadas, cambiar otra cosa de la jornada no vuelve a comprobarlo.
    assert cx.execute("update liga.jornadas set estado = 'formada' where id = %s",
                      (jid,)).rowcount == 1


def test_posiciones_ajenas_con_pro_y_las_de_la_casa_sin_pro_al_cerrar_la_jornada(cx):
    autor, pro, gratis = _usuario(cx, pro=True), _usuario(cx, pro=True), _usuario(cx)
    admin = _usuario(cx, rol="admin")
    jid = _jornada(cx)
    publica, rp = _lista(cx, autor)
    _como(cx, autor)
    cx.execute("update liga.estrategias set visibilidad = 'publicada', declara_posiciones = 'no' "
               "where id = %s", (publica,))
    ip = _inscripcion(cx, jid, publica, rp, ["AAA"])
    _sistema(cx)
    casa = cx.execute("insert into liga.estrategias (tipo, casa_clave, nombre, forma, dibujo, "
                      "color1, color2, estado, dueno_id) values ('casa', 'lambda', 'Lambda', "
                      "'circulo', 'liso', '#D8D4CB', '#D8D4CB', 'jugando', null) returning id"
                      ).fetchone()[0]
    rc = cx.execute("insert into liga.recetas (estrategia_id, catalogo_version, peso_negocio, "
                    "peso_precio, peso_deuda, peso_pronto, peso_pregunta, n_empresas, reparto, "
                    "max_por_sector) values (%s, 1, 25, 25, 25, 25, 0, 5, 'igual', 2) returning id",
                    (casa,)).fetchone()[0]
    ic = _inscripcion(cx, jid, casa, rc, ["CASA1"])

    _como(cx, autor)
    assert _filas(cx, "select ticker from liga.posiciones where inscripcion_id = %s", (ip,)) == \
        [("AAA",)]
    _como(cx, pro)
    assert _filas(cx, "select ticker from liga.posiciones where inscripcion_id = %s", (ip,)) == \
        [("AAA",)]
    assert _filas(cx, "select ticker from liga.posiciones where inscripcion_id = %s", (ic,)) == \
        [("CASA1",)]
    _como(cx, admin)
    assert _filas(cx, "select ticker from liga.posiciones where inscripcion_id = %s", (ic,)) == \
        [("CASA1",)]
    _como(cx, gratis)
    assert _filas(cx, "select 1 from liga.posiciones") == []
    _sistema(cx)
    cx.execute("update liga.jornadas set estado = 'cerrada', sp_rentabilidad = 1 where id = %s",
               (jid,))
    _como(cx, gratis)
    assert _filas(cx, "select ticker from liga.posiciones") == [("CASA1",)]
    _como(cx, None)
    _falla(cx, "select 1 from liga.posiciones")
    assert _filas(cx, "select 1 from liga.inscripciones where id = %s", (ic,)) == [(1,)]


def test_el_admin_cuenta_como_pro_aunque_no_tenga_plan(cx):
    admin, moderador = _usuario(cx, rol="admin"), _usuario(cx, rol="moderador")
    gratis, pro, caducado = _usuario(cx), _usuario(cx, pro=True), _usuario(cx)
    _sistema(cx)
    cx.execute("insert into liga.planes_usuario (usuario_id, plan, desde, hasta, origen) "
               "values (%s, 'pro', now() - interval '2 days', now() - interval '1 day', 'admin')",
               (caducado,))
    for uid, esperado in ((admin, True), (pro, True), (moderador, False), (gratis, False),
                          (caducado, False)):
        _como(cx, uid)
        assert _filas(cx, "select liga.es_pro()") == [(esperado,)]
    _como(cx, None)
    _falla(cx, "select liga.es_pro()")
    _como(cx, admin)
    _falla(cx, "select liga.tiene_pro(%s)", (gratis,))


def test_los_resultados_son_publicos_y_no_se_tocan(cx):
    a = _usuario(cx)
    jid = _jornada(cx)
    eid, rid = _lista(cx, a)
    iid = _inscripcion(cx, jid, eid, rid, ["AAA"])
    _sistema(cx)
    cx.execute("insert into liga.resultados (inscripcion_id, rentabilidad, puntos) "
               "values (%s, 1.2, 3)", (iid,))
    _falla(cx, "update liga.resultados set puntos = 0 where inscripcion_id = %s", (iid,))
    _como(cx, None)
    assert _filas(cx, "select puntos from liga.resultados where inscripcion_id = %s", (iid,)) == \
        [(3,)]
    _falla(cx, "insert into liga.resultados (inscripcion_id, rentabilidad, puntos) "
               "values (%s, 9, 3)", (iid,))


def test_las_suscripciones_de_aviso_son_de_su_cuenta_y_solo_se_crean_y_borran(cx):
    a, b = _usuario(cx), _usuario(cx)
    nueva = ("insert into liga.suscripciones_push (usuario_id, endpoint, p256dh, auth) "
             "values (%s, %s, 'p', 'a')")
    _como(cx, a)
    cx.execute(nueva, (a, "https://fcm.googleapis.com/fcm/send/a"))
    _falla(cx, nueva, (b, "https://fcm.googleapis.com/fcm/send/ajena"))      # no a nombre de otro
    _falla(cx, "update liga.suscripciones_push set p256dh = 'x'")            # sin update
    assert _filas(cx, "select count(*) from liga.suscripciones_push") == [(1,)]
    _como(cx, b)
    assert _filas(cx, "select count(*) from liga.suscripciones_push") == [(0,)]
    assert cx.execute("delete from liga.suscripciones_push").rowcount == 0   # no borra las de a
    _como(cx, None)
    _falla(cx, "select 1 from liga.suscripciones_push")
    _como(cx, a)
    assert cx.execute("delete from liga.suscripciones_push").rowcount == 1


def test_haber_jugado_sin_pregunta_lo_ve_su_dueno_y_el_admin_y_nadie_mas(cx):
    a, otro, adm = _usuario(cx), _usuario(cx), _usuario(cx, rol="admin")
    jid = _jornada(cx)
    eid, rid = _lista(cx, a)
    iid = _inscripcion(cx, jid, eid, rid, ["AAA"])
    _sistema(cx)
    cx.execute("insert into liga.formaciones_degradadas (inscripcion_id, motivo) "
               "values (%s, 'tope')", (iid,))
    _como(cx, a)
    assert _filas(cx, "select motivo from liga.formaciones_degradadas") == [("tope",)]
    _como(cx, otro)
    assert _filas(cx, "select 1 from liga.formaciones_degradadas") == []
    _como(cx, adm, aal="aal2")
    assert _filas(cx, "select motivo from liga.formaciones_degradadas") == [("tope",)]
    _como(cx, None)
    _falla(cx, "select 1 from liga.formaciones_degradadas")
    _como(cx, a)
    _falla(cx, "update liga.formaciones_degradadas set motivo = 'sin_ia'")
    _falla(cx, "delete from liga.formaciones_degradadas")
    _falla(cx, "insert into liga.formaciones_degradadas (inscripcion_id, motivo) "
               "values (%s, 'tope')", (iid,))
    _sistema(cx)
    cx.execute("delete from liga.formaciones_degradadas where inscripcion_id = %s", (iid,))
    _falla(cx, "insert into liga.formaciones_degradadas (inscripcion_id, motivo) "
               "values (%s, 'cualquiera')", (iid,))


# ---- ligas privadas
# ----------------------------------------------------------------------------------

def test_ligas_privadas_solo_con_pro_y_por_codigo(cx):
    p, q, g, fuera = (_usuario(cx, pro=True), _usuario(cx, pro=True), _usuario(cx),
                      _usuario(cx, pro=True))
    _como(cx, g)
    _falla(cx, "insert into liga.ligas_privadas (nombre, codigo) values ('Amigos', 'ABCDEFGH')")
    _como(cx, p)
    lid = cx.execute("insert into liga.ligas_privadas (nombre, codigo) values ('Amigos', "
                     "'ABCDEFGH') returning id").fetchone()[0]
    assert _filas(cx, "select usuario_id from liga.miembros_liga where liga_id = %s", (lid,)) == \
        [(p,)]
    _como(cx, g)
    _falla(cx, "select liga.unirse_liga('ABCDEFGH')")
    _como(cx, q)
    _falla(cx, "select liga.unirse_liga('NOEXISTE')")
    assert cx.execute("select liga.unirse_liga('abcdefgh')").fetchone()[0] == lid
    assert len(_filas(cx, "select 1 from liga.miembros_liga where liga_id = %s", (lid,))) == 2
    _como(cx, fuera)
    assert _filas(cx, "select 1 from liga.ligas_privadas") == []
    assert _filas(cx, "select 1 from liga.miembros_liga") == []
    _como(cx, q)
    assert cx.execute("update liga.ligas_privadas set nombre = 'Mía' where id = %s",
                      (lid,)).rowcount == 0
    assert cx.execute("delete from liga.miembros_liga where liga_id = %s and usuario_id = %s",
                      (lid, q)).rowcount == 1


def test_el_cupo_de_una_liga_se_respeta(cx):
    p, q, r = _usuario(cx, pro=True), _usuario(cx, pro=True), _usuario(cx, pro=True)
    _como(cx, p)
    cx.execute("insert into liga.ligas_privadas (nombre, codigo, cupo) "
               "values ('Dos', 'HJKLMNPQ', 2)")
    _como(cx, q)
    cx.execute("select liga.unirse_liga('HJKLMNPQ')")
    _como(cx, r)
    _falla(cx, "select liga.unirse_liga('HJKLMNPQ')")


# ---- créditos
# ------------------------------------------------------------------------------------------

def test_los_creditos_solo_los_mueve_el_sistema(cx):
    a, b = _usuario(cx), _usuario(cx)
    _como(cx, a)
    _falla(cx, "insert into liga.creditos_movimientos (usuario_id, importe, motivo, idempotencia) "
               "values (%s, 100, 'regalo', 'trampa-0001')", (a,))
    _falla(cx, "select liga.cargar_creditos(%s, 100, 'regalo', 'trampa-0002')", (a,))
    _sistema(cx)
    assert cx.execute("select liga.cargar_creditos(%s, 5, 'recarga', 'recarga-0001')",
                      (a,)).fetchone()[0] == 5
    # Repetir con la misma clave no cobra dos veces.
    assert cx.execute("select liga.cargar_creditos(%s, 5, 'recarga', 'recarga-0001')",
                      (a,)).fetchone()[0] == 5
    assert cx.execute("select liga.cargar_creditos(%s, -1.5, 'prueba', 'prueba-00001')",
                      (a,)).fetchone()[0] == 3.5
    _falla(cx, "select liga.cargar_creditos(%s, -10, 'prueba', 'prueba-00002')", (a,))
    _falla(cx, "update liga.creditos_movimientos set importe = 1000 where usuario_id = %s", (a,))
    _como(cx, a)
    assert _filas(cx, "select saldo from liga.v_saldo") == [(3.5,)]
    _como(cx, b)
    assert _filas(cx, "select 1 from liga.creditos_movimientos") == []
    assert _filas(cx, "select 1 from liga.v_saldo") == []


def test_la_baja_borra_sus_movimientos_en_cascada(cx):
    a = _usuario(cx)
    _sistema(cx)
    cx.execute("select liga.cargar_creditos(%s, 2, 'regalo', 'regalo-00001')", (a,))
    cx.execute("insert into liga.consentimientos (usuario_id, documento, version) "
               "values (%s, 'privacidad', '1')", (a,))
    cx.execute("delete from auth.users where id = %s", (a,))
    assert _filas(cx, "select 1 from liga.creditos_movimientos where usuario_id = %s", (a,)) == []


def test_lecturas_solo_si_las_compraste(cx):
    a, b = _usuario(cx), _usuario(cx)
    _sistema(cx)
    lid = cx.execute("insert into liga.lecturas (ticker, foto_id, texto) values ('AAA', 1, 'x') "
                     "returning id").fetchone()[0]
    cx.execute("select liga.cargar_creditos(%s, 1, 'regalo', 'regalo-00002')", (a,))
    cx.execute("select liga.cargar_creditos(%s, -0.05, 'lectura', 'lectura-0001', null, %s)",
               (a, lid))
    _como(cx, a)
    assert _filas(cx, "select id from liga.lecturas") == [(lid,)]
    _como(cx, b)
    assert _filas(cx, "select id from liga.lecturas") == []


# ---- admin y salas
# ----------------------------------------------------------------------------------

def test_admin_sin_2fa_no_toca_las_salas_ni_la_liga(cx):
    adm, a = _usuario(cx, rol="admin"), _usuario(cx)
    _estrategia(cx, a)
    _como(cx, adm, aal="aal1")
    assert _filas(cx, "select 1 from public.scores limit 1") == []
    assert _filas(cx, "select 1 from liga.estrategias where dueno_id = %s", (a,)) == []
    _como(cx, adm, aal="aal2")
    _sistema(cx)
    hay_scores = bool(_filas(cx, "select 1 from public.scores limit 1"))
    _como(cx, adm, aal="aal2")
    assert bool(_filas(cx, "select 1 from public.scores limit 1")) == hay_scores
    assert len(_filas(cx, "select 1 from liga.estrategias where dueno_id = %s", (a,))) == 1


def test_un_usuario_normal_no_ve_nada_de_las_salas(cx):
    a = _usuario(cx, pro=True)
    _como(cx, a, aal="aal2")
    assert _filas(cx, "select 1 from public.scores limit 1") == []
    _como(cx, None)
    _falla(cx, "select 1 from public.scores limit 1")
    _falla(cx, "select 1 from public.precio_cierre limit 1")


def test_el_hook_pone_rol_y_plan_en_el_token(cx):
    adm = _usuario(cx, rol="admin", pro=True)
    _sistema(cx)
    cx.execute("set local role supabase_auth_admin")
    evento = json.dumps({"user_id": str(adm), "claims": {"sub": str(adm), "aal": "aal1"}})
    claims = cx.execute("select liga.custom_access_token_hook(%s::jsonb) -> 'claims'",
                        (evento,)).fetchone()[0]
    assert claims["user_role"] == "admin" and claims["plan"] == "pro"


# ---- cobertura
# -----------------------------------------------------------------------------------------

def test_toda_tabla_tiene_rls_y_politicas(cx):
    _sistema(cx)
    sin = _filas(cx, """
        select n.nspname || '.' || c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('liga', 'public') and c.relkind in ('r', 'p')
          and (not c.relrowsecurity
               or not exists (select 1 from pg_policies p
                              where p.schemaname = n.nspname and p.tablename = c.relname))""")
    assert sin == []


def test_ninguna_politica_de_escritura_abre_con_true(cx):
    _sistema(cx)
    abiertas = _filas(cx, """
        select schemaname || '.' || tablename || ' ' || policyname from pg_policies
        where schemaname in ('liga', 'public') and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')""")
    assert abiertas == []


def test_anon_solo_lee_lo_publico(cx):
    _sistema(cx)
    concedido = {r[0] for r in _filas(cx, """
        select c.relname || ':' || p.privilege_type from pg_class c
        join pg_namespace n on n.oid = c.relnamespace,
        lateral (select unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege_type) p
        where n.nspname = 'liga' and c.relkind in ('r', 'v')
          and has_table_privilege('anon', c.oid, p.privilege_type)""")}
    assert concedido == {f"{t}:SELECT" for t in (
        "perfiles", "temporadas", "jornadas", "estrategias", "inscripciones", "resultados",
        "v_clasificacion")}
    en_public = _filas(cx, """
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and has_table_privilege('anon', c.oid, 'SELECT')""")
    assert en_public == []


def test_funciones_security_definer_solo_para_quien_toca(cx):
    _sistema(cx)
    ejecutables = {(r[0], r[1]) for r in _filas(cx, """
        select p.proname, r.rolname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        cross join (values ('anon'), ('authenticated')) r(rolname)
        where n.nspname = 'liga' and p.prosecdef
          and has_function_privilege(r.rolname, p.oid, 'EXECUTE')""")}
    assert ejecutables == {
        ("authorize", "authenticated"), ("es_pro", "authenticated"),
        ("puede_ver_posiciones", "authenticated"), ("es_miembro", "authenticated"),
        ("unirse_liga", "authenticated"), ("registrar_visita", "authenticated"),
        ("exportar_visitas", "authenticated"),
    }
