"""Procesos del blog con sesión y correo simulados."""

import io
import json
import tarfile
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app import correo
from app.liga import blog_procesos as procesos
from app.liga import copia


class _Resultado:
    def __init__(self, filas=(), rowcount=0):
        self.filas = list(filas)
        self.rowcount = rowcount

    def scalars(self):
        return self

    def mappings(self):
        return self

    def all(self):
        return self.filas

    def scalar_one(self):
        return self.filas[0]

    def scalar(self):
        return self.filas[0] if self.filas else None

    def first(self):
        return self.filas[0] if self.filas else None


class _Db:
    def __init__(self, n=3):
        self.ahora = datetime.now(UTC)
        self.articulos = []
        self.envios = {}
        self.entregas = [dict(envio_id=1, suscriptor_id=i, idioma="es",
            correo=f"cuenta{i}@ejemplo.com", token_baja="x" * 32, slug="articulo",
            titulo="Título", resumen="Resumen", estado="pendiente", confirmado=True,
            intentada_en=None) for i in range(n)]
        self.envio = "pendiente"
        self.usados = 0
        self.suscriptores = []
        self.auditoria = []

    def execute(self, sql, params=None):
        q = str(sql)
        if "pg_advisory" in q:
            return _Resultado()
        if "update blog.articulos" in q:
            assert "programado_para <= now()" in q
            assert "t.idioma in ('es', 'en')" in q
            assert "t.titulo ~" in q and "t.cuerpo ~" in q
            ids = []
            for a in self.articulos:
                if a.estado == "programado" and a.fecha <= self.ahora and a.completo:
                    a.estado = "publicado"
                    ids.append({"id": a.id, "avisar_boletin": getattr(a, "avisar_boletin", False)})
            return _Resultado(ids)
        if "select * from blog.articulos" in q:
            a = next(a for a in self.articulos if a.id == params["id"])
            return _Resultado([vars(a)])
        if "insert into blog.envios" in q:
            assert "on conflict (articulo_id, idioma)" in q
            assert "do nothing returning id" in q
            clave = (params["id"], params["idioma"])
            if clave in self.envios:
                return _Resultado()
            self.envios[clave] = len(self.envios) + 1
            return _Resultado([self.envios[clave]])
        if "insert into blog.entregas" in q:
            assert "estado = 'confirmado' and idioma = :idioma" in q
            return _Resultado(rowcount=0)
        if "select count(*) from blog.entregas" in q:
            if "intentada_en >=" in q:
                assert "at time zone 'UTC'" in q
                return _Resultado([self.usados + sum(d["intentada_en"] is not None
                                                   for d in self.entregas)])
            return _Resultado([sum(d["estado"] == "pendiente" for d in self.entregas)])
        if "select entregas.envio_id" in q:
            assert "for update of entregas skip locked" in q
            assert "s.estado = 'confirmado' and s.idioma = e.idioma" in q
            return _Resultado([d.copy() for d in self.entregas
                if d["estado"] == "pendiente" and d["confirmado"]][:params["limite"]])
        if "update blog.entregas" in q:
            d = next(d for d in self.entregas if d["suscriptor_id"] == params["sid"])
            d.update(estado=params["estado"], intentada_en=self.ahora)
        elif "set estado = 'en_curso'" in q:
            self.envio = "en_curso"
        elif "set estado = 'terminado'" in q:
            if not any(d["estado"] == "pendiente" for d in self.entregas):
                self.envio = "terminado"
        elif "delete from blog.suscriptores" in q:
            antes = len(self.suscriptores)
            self.suscriptores = [s for s in self.suscriptores
                if not (s.estado == "pendiente" and s.expira < self.ahora)]
            return _Resultado(rowcount=antes - len(self.suscriptores))
        else:
            raise AssertionError(q)
        return _Resultado()

    def add(self, registro):
        self.auditoria.append(registro)

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass


@pytest.fixture
def buzon(monkeypatch):
    enviados = []
    monkeypatch.setattr(correo, "enviar", lambda *args: enviados.append(args) or True)
    return enviados


@pytest.mark.parametrize("completo, dias, esperado", [
    (True, -1, "publicado"), (False, -1, "programado"), (True, 1, "programado")])
def test_publicacion(completo, dias, esperado):
    db = _Db(0)
    a = SimpleNamespace(id=1, estado="programado", completo=completo,
                        fecha=db.ahora + timedelta(days=dias))
    db.articulos.append(a)
    procesos.publicar_programados(lambda: db)
    assert a.estado == esperado
    assert len(db.auditoria) == (esperado == "publicado")


def test_envio_aceptado_y_enlaces(buzon):
    db = _Db()
    procesos.enviar_lote(lambda: db)
    assert len(buzon) == 3
    assert all(d["estado"] == "aceptada" for d in db.entregas)
    assert db.envio == "terminado"
    assert "/blog/articulo" in buzon[0][2]
    assert "/blog/boletin/baja?token=" in buzon[0][2]
    assert buzon[0][0] not in buzon[0][2]
    assert len(db.auditoria) == 1


def test_fallidas_no_se_reintentan(monkeypatch):
    db = _Db()
    llamadas = []
    monkeypatch.setattr(correo, "enviar", lambda *args: llamadas.append(args) and False)
    procesos.enviar_lote(lambda: db)
    procesos.enviar_lote(lambda: db)
    assert len(llamadas) == 3
    assert all(d["estado"] == "fallida" for d in db.entregas)
    assert db.envio == "terminado"


@pytest.mark.parametrize("usados, numero, esperados", [(20, 3, 0), (19, 3, 1), (0, 12, 10)])
def test_cupo_y_lote(buzon, usados, numero, esperados):
    db = _Db(numero)
    db.usados = usados
    procesos.enviar_lote(lambda: db)
    assert len(buzon) == esperados


def test_baja_no_recibe(buzon):
    db = _Db()
    db.entregas[0]["confirmado"] = False
    procesos.enviar_lote(lambda: db)
    assert len(buzon) == 2
    assert db.entregas[0]["estado"] == "pendiente"


def test_limpieza():
    db = _Db(0)
    db.suscriptores = [SimpleNamespace(estado=e, expira=db.ahora + timedelta(days=d))
                        for e, d in [("pendiente", -1), ("confirmado", -1), ("pendiente", 1)]]
    assert procesos.limpiar_pendientes(lambda: db) == 1
    assert len(db.suscriptores) == 2
    assert db.auditoria[0].detalle == {"borrados": 1}


def test_job_oculta_datos_del_error(monkeypatch):
    fallos = []
    def fallo(fabrica):
        raise RuntimeError("correo y token privados")
    monkeypatch.setattr(procesos, "enviar_lote", fallo)
    monkeypatch.setattr(procesos, "auditar_fallo", lambda *args: fallos.append(args))
    procesos.job_enviar_lote(lambda: None)
    assert len(fallos) == 1
    assert "privados" not in str(fallos[0][3])


def test_copia_y_restauracion_blog(monkeypatch, tmp_path):
    # `scripts/` no está en Git: sin el fichero local, la prueba se salta.
    restaurar_liga = pytest.importorskip("scripts.restaurar_liga")

    consultas = []
    @contextmanager
    def copiar(sql):
        consultas.append(sql)
        yield [b"id\n1\n"]
    class Cursor:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        copy = staticmethod(copiar)
    db = _Db(0)
    db.connection = lambda: SimpleNamespace(connection=SimpleNamespace(
        dbapi_connection=SimpleNamespace(cursor=Cursor)))
    monkeypatch.setattr(copia, "fabrica_sistema", lambda: db)
    datos = copia.generar(None)
    with tarfile.open(fileobj=io.BytesIO(datos), mode="r:gz") as tar:
        manifiesto = json.load(tar.extractfile("manifiesto.json"))
        assert [t["tabla"] for t in manifiesto["tablas"]][-5:] == [
            f"blog.{t}" for t in copia.TABLAS_BLOG]
    destino = tmp_path / "copia.tar.gz"
    destino.write_bytes(datos)
    cargadas = []
    class Conexion(Cursor):
        def execute(self, sql):
            consultas.append(sql)
            return SimpleNamespace(fetchone=lambda: (0,))
        def cursor(self):
            return self
        @contextmanager
        def copy(self, sql):
            cargadas.append(sql)
            yield SimpleNamespace(write=lambda datos: None)
        def commit(self):
            pass
    with monkeypatch.context() as parche:
        parche.setattr(restaurar_liga.psycopg, "connect", lambda url, **_: Conexion())
        restaurar_liga.restaurar(destino, "simulada")
    assert [q.split()[1] for q in cargadas][-5:] == [f"blog.{t}" for t in copia.TABLAS_BLOG]
    assert sum("select setval" in q for q in consultas) == 3


@pytest.mark.parametrize("avisar_boletin", [True, False])
def test_publicacion_programada_con_boletin(avisar_boletin):
    db = _Db(0)
    a = SimpleNamespace(id=1, estado="programado", completo=True,
                        fecha=db.ahora - timedelta(days=1), avisar_boletin=avisar_boletin)
    db.articulos.append(a)
    assert procesos.publicar_programados(lambda: db) == 1
    assert a.estado == "publicado"
    assert set(db.envios) == ({(1, "es"), (1, "en")} if avisar_boletin else set())
    assert procesos.publicar_programados(lambda: db) == 0
    assert len(db.envios) == (2 if avisar_boletin else 0)
