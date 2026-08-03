"""Concilia el coste que AUTO-REPORTA cada escaneo contra el consumo real de OpenRouter.

El coste que persiste cada escaneo (`app.scan_service._llm_usage`, viajero en el informe como
`cost`) sale de sumar el `usage` de cada respuesta del LLM: coste real si OpenRouter lo incluyó,
estimado por precios locales si no — es una cifra que el propio backend se auto-reporta, nunca
un cargo verificado por un tercero. Este script sí pregunta a la fuente ajena: los créditos y el
consumo ACUMULADO de la cuenta.

Uso (desde la carpeta backend):
    uv run python scripts/reconcile_openrouter.py

OpenRouter no expone el gasto de UN escaneo suelto (solo el acumulado de la cuenta), así que
este script no concilia nada por sí solo: imprime el acumulado de ahora mismo y el coste
registrado del último escaneo, y explica cómo cerrar el círculo a mano (ver el print final).
"""

from __future__ import annotations

import json

import httpx

from app.config import settings
from app.db import SessionLocal
from app.models import Meta

CREDITS_URL = "https://openrouter.ai/api/v1/credits"
_REPORT_KEY = "last_scan_report"   # misma clave que app.scan_service._REPORT_KEY


def _credits() -> dict | None:
    """Créditos y consumo acumulados de la cuenta, o None si falta la key o la llamada falla
    (diagnóstico manual: un fallo de red aquí no debe reventar el script)."""
    if not settings.openrouter_api_key:
        print("OPENROUTER_API_KEY vacía en backend/.env — no se puede consultar OpenRouter.")
        return None
    try:
        resp = httpx.get(
            CREDITS_URL,
            headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
            timeout=15.0,
        )
        resp.raise_for_status()
        return resp.json().get("data") or {}
    except Exception as exc:  # noqa: BLE001 — el motivo va impreso, no hace falta el traceback
        print(f"No se pudo consultar OpenRouter: {exc}")
        return None


def _ultimo_escaneo(db) -> dict | None:  # noqa: ANN001
    """El informe persistido del último escaneo (el mismo Meta que lee GET /scan/report)."""
    row = db.get(Meta, _REPORT_KEY)
    if row is None:
        return None
    try:
        return json.loads(row.value)
    except ValueError:
        return None


def main() -> None:
    creditos = _credits()
    if creditos is not None:
        print("== OpenRouter (cuenta) ==")
        print(f"  total_credits: {creditos.get('total_credits')}")
        print(f"  total_usage:   {creditos.get('total_usage')}  (USD consumidos acumulados)")

    db = SessionLocal()
    try:
        report = _ultimo_escaneo(db)
    finally:
        db.close()

    print("\n== Último escaneo (BD local) ==")
    if report is None:
        print("  No hay informe de escaneo persistido todavía.")
    else:
        print(f"  fecha: {report.get('at')}")
        print(f"  modo:  {report.get('mode')}")
        print(f"  coste registrado: {report.get('cost')}")

    print(
        "\nPara conciliar: corre este script justo ANTES de lanzar un escaneo y otra vez justo "
        "DESPUÉS; la diferencia de total_usage entre ambas corridas debería aproximarse al "
        "cost_usd que quedó registrado en ese escaneo. No va a coincidir al céntimo (OpenRouter "
        "redondea y factura con algo de retraso), pero una desviación grande delata un fallo de "
        "cálculo en `_llm_usage`."
    )


if __name__ == "__main__":
    main()
