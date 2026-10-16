"""Resúmenes con correo y sesiones simulados, sin llamadas de red."""

from contextlib import nullcontext
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import correo
from app.i18n import translate
from app.liga import resumenes, rutas_avisos, rutas_gestion
from app.liga.auth import require_admin, require_usuario
from app.liga.db import db_usuario


class _Resultado:
    def __init__(self, filas=()):
        self.filas = list(filas)

    def scalars(self):
        return self

    def all(self):
        return self.filas

    def first(self):
        return self.filas[0] if self.filas else None

    def one_or_none(self):
        return self.first()

    def scalar_one(self):
        return self.filas[0]


class _Db:
    def __init__(self, cuentas):
        self.cuentas = cuentas
        self.auditoria = []
        self.activo = True

    def execute(self, sql, params=None):
        consulta = str(sql)
        if 'pg_advisory' in consulta:
            return _Resultado()
        if 'select count(*) from liga.auditoria' in consulta:
            return _Resultado([len(self.auditoria)])
        if 'from liga.auditoria' in consulta:
            return _Resultado([a for a in self.auditoria
                               if a.objeto == params['o'] and a.accion == 'resumen.enviado'])
        if 'select p.id::text' in consulta:
            assert "r.rol = 'usuario'" in consulta
            assert 'p.baja_solicitada is null' in consulta
            return _Resultado([c['usuario_id'] for c in self.cuentas if c['activo']])
        if 'u.email' in consulta:
            c = next(c for c in self.cuentas if c['usuario_id'] == params['u'])
            return _Resultado([SimpleNamespace(idioma=c['idioma'], avisos_correo=c['activo'],
                                               correo_avisos=None, email=c['destino'])])
        if 'update liga.perfiles_privados' in consulta:
            assert 'auth.uid()' in consulta
            self.activo = params['a']
            return _Resultado()
        if 'select resumen_correo' in consulta:
            assert 'auth.uid()' in consulta
            return _Resultado([self.activo])
        raise AssertionError(consulta)

    def begin_nested(self):
        return nullcontext()

    def add(self, registro):
        self.auditoria.append(registro)

    def flush(self):
        pass

    def commit(self):
        pass

    def rollback(self):
        pass


def cuenta(n, activo=True, idioma='es'):
    return {'usuario_id': f'00000000-0000-0000-0000-{n:012d}', 'activo': activo,
            'idioma': idioma, 'destino': f'cuenta{n}@ejemplo.com'}


@pytest.fixture
def buzon(monkeypatch):
    enviados = []
    monkeypatch.setattr(correo, 'enviar', lambda destino, asunto, texto, html=None:
                        enviados.append((destino, asunto, texto, html)) or True)
    return enviados


@pytest.fixture
def datos(monkeypatch):
    valor = {'numero': 1, 'estrategia': 'Ejemplo', 'rentabilidad': 2, 'sp': 1,
             'puesto_general': 3, 'ligas': [{'nombre': 'Amigos', 'puesto': 1}],
             'entran': ['AAPL'], 'salen': ['MSFT'], 'provisional': True}
    monkeypatch.setattr(resumenes, 'contenido', lambda *a: valor)
    return valor


def test_preferencia_y_un_envio_por_tipo_y_jornada(buzon, datos):
    db = _Db([cuenta(1, False), cuenta(2)])
    assert resumenes.enviar_lote(db, 'semanal', 1)['enviados'] == 1
    assert resumenes.enviar_lote(db, 'semanal', 1) == {
        'enviados': 0, 'pendientes': 0, 'omitidos': 1}
    assert resumenes.enviar_lote(db, 'mensual', 1)['enviados'] == 1
    assert resumenes.enviar_lote(db, 'semanal', 2)['enviados'] == 1
    assert {c[0] for c in buzon} == {'cuenta2@ejemplo.com'}


def test_lote_deja_pendientes(buzon, datos):
    db = _Db([cuenta(n) for n in range(3)])
    assert resumenes.enviar_lote(db, 'semanal', 1, limite=2) == {
        'enviados': 2, 'pendientes': 1, 'omitidos': 0}
    assert resumenes.enviar_lote(db, 'semanal', 1, limite=2) == {
        'enviados': 1, 'pendientes': 0, 'omitidos': 2}
    assert len(buzon) == 3


def test_cupo_compartido_entre_tipos(buzon, datos):
    db = _Db([cuenta(n) for n in range(81)])
    assert resumenes.enviar_lote(db, 'semanal', 1)['enviados'] == 80
    assert resumenes.enviar_lote(db, 'mensual', 1)['enviados'] == 0
    assert len(buzon) == 80


@pytest.mark.parametrize('idioma', ['es', 'en'])
@pytest.mark.parametrize('tipo', ['semanal', 'mensual'])
def test_texto_descriptivo(buzon, datos, idioma, tipo):
    resumenes.enviar_lote(_Db([cuenta(1, idioma=idioma)]), tipo, 1)
    assert len(buzon) == 1
    for palabra in ('compra', 'vende', 'comprar', 'vender', 'buy', 'sell'):
        assert palabra not in (buzon[0][1] + buzon[0][2] + buzon[0][3]).lower()


def test_fallo_no_impide_siguiente(monkeypatch, buzon, datos):
    real = correo.enviar
    def enviar(destino, *args):
        if destino == 'cuenta1@ejemplo.com':
            raise RuntimeError('sin red')
        return real(destino, *args)
    monkeypatch.setattr(correo, 'enviar', enviar)
    assert resumenes.enviar_lote(_Db([cuenta(1), cuenta(2)]), 'semanal', 1) == {
        'enviados': 1, 'pendientes': 1, 'omitidos': 0}


def test_patch_preferencia(monkeypatch):
    app = FastAPI()
    app.include_router(rutas_avisos.router, prefix='/liga')
    db = _Db([])
    app.dependency_overrides[db_usuario] = lambda: db
    app.dependency_overrides[require_usuario] = lambda: SimpleNamespace(uid=cuenta(1)['usuario_id'])
    monkeypatch.setattr(rutas_avisos.avisos, 'dispositivos', lambda uid: [])
    cliente = TestClient(app)
    for activo in (False, True):
        respuesta = cliente.patch('/liga/avisos/resumen', json={'activo': activo})
        assert respuesta.status_code == 200
        assert respuesta.json()['resumen_correo'] is activo
        assert cliente.get('/liga/avisos').json()['resumen_correo'] is activo


def test_prueba_exige_admin_y_envia_solo_a_quien_llama(monkeypatch, buzon, datos):
    app = FastAPI()
    app.include_router(rutas_gestion.router_admin, prefix='/liga/admin')
    def denegar():
        raise HTTPException(403)
    app.dependency_overrides[require_admin] = denegar
    cliente = TestClient(app)
    assert cliente.post('/liga/admin/resumenes/prueba', json={'tipo': 'semanal'}).status_code == 403
    db = _Db([cuenta(1), cuenta(2)])
    app.dependency_overrides[require_admin] = lambda: SimpleNamespace(uid=cuenta(1)['usuario_id'])
    monkeypatch.setattr(resumenes, '_jornada_actual', lambda db: 1)
    monkeypatch.setattr(resumenes, 'sesion', lambda fabrica: nullcontext(db))
    respuesta = cliente.post('/liga/admin/resumenes/prueba', json={'tipo': 'semanal'})
    assert respuesta.status_code == 200
    assert respuesta.json() == {'enviados': 1}
    assert [c[0] for c in buzon] == ['cuenta1@ejemplo.com']


@pytest.mark.parametrize('idioma', ['es', 'en'])
def test_traducciones(idioma):
    for sufijo in ('semanal_asunto', 'mensual_asunto', 'intro', 'baja', 'rentabilidad',
                   'sp', 'puesto_general', 'puesto_liga', 'entran', 'salen', 'ninguna',
                   'estrategia', 'provisional'):
        clave = f'correo_resumen_{sufijo}'
        assert translate(clave, idioma, numero=1, nombre='Amigos') != clave

@pytest.mark.parametrize('dos_jornadas', [False, True])
def test_contenido_usa_vivo_y_compara_posiciones(monkeypatch, dos_jornadas):
    from datetime import date

    jornada = SimpleNamespace(id=2, numero=2, temporada_id=1, estado='formada',
                              dia_base=date(2027, 2, 1), sp_rentabilidad=None)
    class DbContenido:
        def get(self, modelo, jid):
            return jornada

        def execute(self, sql, params=None):
            consulta = str(sql)
            if 'e.nombre, i.id as iid' in consulta:
                return _Resultado([SimpleNamespace(eid='e1', nombre='Ejemplo', iid=20,
                                                   rentabilidad=None)])
            if 'from liga.v_clasificacion' in consulta:
                return _Resultado([SimpleNamespace(eid='e1', creada=1, puntos=3, dif_sp=1,
                                                   _mapping={'eid': 'e1', 'creada': 1,
                                                             'puntos': 3, 'dif_sp': 1})])
            if 'select i.id from liga.inscripciones' in consulta:
                return _Resultado([20, 10] if dos_jornadas else [20])
            if 'select ticker' in consulta:
                return _Resultado(['ZZZ', 'AAA', 'KEEP'] if params['i'] == 20
                                  else ['OLD', 'KEEP'])
            if 'from liga.ligas_privadas' in consulta:
                return _Resultado([SimpleNamespace(id='l1', nombre='Amigos')])
            raise AssertionError(consulta)

    monkeypatch.setattr(resumenes.diario, 'vivo', lambda jid: {
        'por_inscripcion': {20: {'rentabilidad': 5}}, 'sp': 2})
    monkeypatch.setattr(resumenes.gestion, '_ajuste_booleano', lambda *a: True)
    llamadas = []
    def viva(*args):
        llamadas.append(args)
        return {'e1': SimpleNamespace(puntos=6, dif_sp=3, jornadas=2)}
    monkeypatch.setattr(resumenes.comparativa, 'clasificacion_viva', viva)
    monkeypatch.setattr(resumenes.rutas_ligas, '_miembros', lambda *a: [SimpleNamespace(
        _mapping={'liga_id': 'l1', 'usuario_id': 'u1', 'estrategia_id': 'e1',
                  'puntos': 3, 'dif_sp': 1, 'alias': 'ana', 'jornadas': 1})])
    resultado = resumenes.contenido(DbContenido(), 'u1', 'semanal', 2)
    assert resultado['rentabilidad'] == 5
    assert resultado['sp'] == 2
    assert resultado['provisional'] is True
    assert resultado['puesto_general'] == 1
    assert resultado['ligas'] == [{'nombre': 'Amigos', 'puesto': 1}]
    assert resultado['entran'] == (['AAA', 'ZZZ'] if dos_jornadas else [])
    assert resultado['salen'] == (['OLD'] if dos_jornadas else [])
    assert len(llamadas) == 1


def test_correo_rechazado_queda_pendiente(monkeypatch, datos):
    db = _Db([cuenta(1)])
    monkeypatch.setattr(correo, 'enviar', lambda *a: False)
    assert resumenes.enviar_lote(db, 'semanal', 1) == {
        'enviados': 0, 'pendientes': 1, 'omitidos': 0}
    assert db.auditoria == []
