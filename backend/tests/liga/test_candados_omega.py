import re
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace


def test_todo_candado_usado_esta_registrado():
    from app.liga.procesos.comun import _HILOS

    app = Path(__file__).resolve().parents[2] / "app"
    usados = set()
    for fichero in app.rglob("*.py"):
        usados.update(re.findall(r'candado\(\s*"([a-z_]+)"', fichero.read_text(encoding="utf-8")))

    assert usados <= set(_HILOS)
    assert "omega_captura" in usados


def test_la_foto_se_guarda_antes_de_sincronizar(monkeypatch, caplog):
    from app import scheduler
    from app.liga.procesos import comun, omega

    eventos = []

    class Db:
        def scalars(self, consulta):
            return [SimpleNamespace(id=1, estado="formada")]

        def commit(self):
            eventos.append("commit")

    @contextmanager
    def candado(nombre, fabrica):
        yield

    @contextmanager
    def sesion(fabrica):
        yield Db()

    def capturar_alertas(db):
        eventos.append("captura")
        return 300

    def sincronizar(db, jornada, hoy):
        eventos.append("sincronizado")
        raise RuntimeError("sync roto")

    monkeypatch.setattr(comun, "candado", candado)
    monkeypatch.setattr(comun, "sesion", sesion)
    monkeypatch.setattr(omega, "capturar_alertas", capturar_alertas)
    monkeypatch.setattr(omega, "sincronizar", sincronizar)

    scheduler._liga_omega_captura_job()

    assert eventos == ["captura", "commit", "sincronizado"]
    assert "Fallo de la captura de Omega" in caplog.text
