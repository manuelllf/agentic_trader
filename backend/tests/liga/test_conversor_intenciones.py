"""Conversor y registro anónimo con proveedor y sesiones falsos."""

import json
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.i18n import current_locale
from app.liga import intenciones, rutas_admin, rutas_ia
from app.liga.ia import conversor
from app.liga.models import IntencionSinRegla


@pytest.mark.parametrize("idioma", ["es", "en"])
def test_respuesta_sin_nombre_y_registro_anonimo(monkeypatch, idioma):
    db = MagicMock()
    monkeypatch.setattr(conversor, "fabrica_sistema", lambda: db)
    monkeypatch.setattr(conversor, "_empresas_actuales", lambda: ())
    usos = SimpleNamespace(pro=True, con_uno_mas=lambda: SimpleNamespace(quedan=9))
    monkeypatch.setattr(conversor.limites, "exigir_conversor_disponible",
                        lambda *args: (usos, "estrategia-privada"))
    bruto = {
        "reglas": [{"clave": "deuda", "params": {"anios": 2}}],
        "nombre": "Nombre que debe ignorarse", "interpretacion": [
            {"intencion": "poca deuda", "tipo": "exacta", "regla": "deuda"},
            {"intencion": "DEFENSÍVAS", "tipo": "aproximada", "regla": "deuda"},
            {"intencion": "defensivas", "tipo": "aproximada", "regla": "deuda"},
            {"intencion": "ética", "tipo": "no_disponible"},
        ],
    }
    monkeypatch.setattr(conversor.comun, "llamar_ia", lambda **kwargs: (json.dumps(bruto), None))
    monkeypatch.setattr(conversor.comun, "registrar_llamada", lambda **kwargs: None)
    token = current_locale.set(idioma)
    try:
        salida = rutas_ia.convertir(rutas_ia.ConvertirIn(frase="frase privada del usuario"),
                                   SimpleNamespace(uid="usuario-privado"))
    finally:
        current_locale.reset(token)
    assert "nombre" not in salida.model_dump()
    filas = db.add_all.call_args.args[0]
    assert [(f.tipo, f.regla) for f in filas] == [
        ("aproximada", "deuda"), ("no_disponible", None)]
    assert all(f.idioma == idioma and f.creado_por is None for f in filas)
    assert all(set(f.__dict__) - {"_sa_instance_state"} ==
               {"intencion", "tipo", "regla", "idioma", "creado_por"} for f in filas)
    assert "frase privada" not in repr([f.intencion for f in filas])
    db.commit.assert_called_once()
    db.close.assert_called_once()


def test_fallo_al_guardar_no_tumba_la_conversion():
    db = MagicMock()
    db.commit.side_effect = RuntimeError("caída de la base")
    intenciones.guardar([conversor.Interpretacion("valor", "aproximada", "barata", "")],
                        "es", lambda: db)
    db.rollback.assert_called_once()
    db.close.assert_called_once()


def test_solo_exactas_no_abren_sesion():
    fabrica = MagicMock()
    intenciones.guardar([conversor.Interpretacion("valor", "exacta", "barata", "")],
                        "es", fabrica)
    fabrica.assert_not_called()
    assert "nombre" not in asdict(conversor.Sugerencia([], None, None, []))


def test_agrupado_normaliza_y_cuenta():
    ahora = datetime.now(UTC)
    db = MagicMock()
    db.scalars.return_value.all.return_value = [
        IntencionSinRegla(intencion=texto, tipo=tipo, regla=regla, creado_en=fecha)
        for texto, tipo, regla, fecha in [
            (" ÉTICA ", "aproximada", "deuda", ahora - timedelta(days=2)),
            ("etica", "no_disponible", None, ahora - timedelta(days=1)),
            ("Ética", "no_disponible", None, ahora),
            ("otro", "aproximada", "beta", ahora),
        ]
    ]
    resultado = rutas_admin.listar_intenciones(dias=90, db=db)
    assert resultado[0] == {"intencion": "etica", "recuento": 3,
                            "tipo": "no_disponible", "regla": None,
                            "primera": ahora - timedelta(days=2), "ultima": ahora}
    assert resultado[1]["recuento"] == 1
    consulta = db.scalars.call_args.args[0]
    assert "creado_en >=" in str(consulta)
    assert any(getattr(r, "path", None) == "/liga/admin/intenciones" and r.dependencies
               for r in rutas_admin.router.routes)


def test_prompt_contiene_glosario_y_no_pide_nombre():
    prompt = conversor._system_prompt("es")
    assert "maduros" in prompt and "vacas lecheras" in prompt
    assert '"nombre"' not in prompt
    for clave in ("fcf", "payout", "beta", "margen", "rentables", "barata", "pb",
                  "ev_ebitda", "dividendo", "crecen", "margen_neto", "deuda",
                  "caja_neta", "tamano", "sin_bancos", "sin_energia", "sin_tabaco"):
        assert clave in prompt
