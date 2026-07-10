"""Validación READ-ONLY de la conexión IBKR Web API (OAuth 1.0a).

NO envía ninguna orden. Solo comprueba, en este orden:
  1) que están las 7 credenciales,
  2) que la sesión OAuth se establece (check_health),
  3) que se puede leer la cuenta (portfolio_accounts),
  4) que se resuelve un conid y se lee un precio (marketdata_history).

Uso (desde backend/):  uv run --system-certs python scripts/verify_ibkr.py

Ejecútalo cuando IBKR haya ACTIVADO tu consumer key (puede tardar 24h-2 semanas tras el
alta en el portal). Si algo falla, el mensaje dice qué paso reventó.
"""

from __future__ import annotations

import sys

# Permite ejecutarlo como script suelto (añade el backend/ al path).
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

from app.brokers import ibkr_web  # noqa: E402
from app.config import settings  # noqa: E402


def main() -> int:
    print("== Validación IBKR Web API (read-only, sin órdenes) ==\n")

    # 1) credenciales
    missing = [
        name for name, val in [
            ("IBKR_ACCOUNT_ID", settings.ibkr_account_id),
            ("IBKR_OAUTH_CONSUMER_KEY", settings.ibkr_oauth_consumer_key),
            ("IBKR_OAUTH_ACCESS_TOKEN", settings.ibkr_oauth_access_token),
            ("IBKR_OAUTH_ACCESS_TOKEN_SECRET", settings.ibkr_oauth_access_token_secret),
            ("IBKR_OAUTH_SIGNATURE_KEY_PATH", settings.ibkr_oauth_signature_key_path),
            ("IBKR_OAUTH_ENCRYPTION_KEY_PATH", settings.ibkr_oauth_encryption_key_path),
            ("IBKR_OAUTH_DH_PRIME", settings.ibkr_oauth_dh_prime),
        ] if not val
    ]
    if missing:
        print("[1/4] FALTAN credenciales en .env:")
        for m in missing:
            print(f"       - {m}")
        print("\n  -> Completa el alta en el portal Self-Service OAuth y pega los 4 valores")
        print("     que faltan (account id, consumer key, access token, access token secret).")
        return 1
    print("[1/4] credenciales presentes: OK")

    # 2) sesión / salud
    try:
        broker = ibkr_web.IbkrWebBroker()
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "invalid consumer" in msg:
            print("[2/4] IBKR responde 401 'invalid consumer'.")
            print("\n  -> Tu consumer key aún NO está activada por IBKR. Esto es normal: tarda")
            print("     de 24h a 2 semanas tras registrarla. La configuración es correcta")
            print("     (IBKR validó la firma; solo falta que provisione la key).")
            print("     Reintenta este script en un día. Nada más que hacer por ahora.")
            return 2
        print(f"[2/4] No se pudo inicializar el cliente: {msg}")
        return 1
    st = broker.status()
    print(f"[2/4] estado de sesión: {st['detail']}")

    # 3) cuenta
    try:
        accts = broker._client.portfolio_accounts().data  # noqa: SLF001 (script de diagnóstico)
        print(f"[3/4] cuentas visibles: {accts}")
    except Exception as exc:  # noqa: BLE001
        print(f"[3/4] no se pudieron leer las cuentas: {exc}")
        return 1

    # 4) conid + precio de un nombre conocido
    try:
        conid = broker._conid("AAPL")  # noqa: SLF001
        px = broker._reference_price(conid)  # noqa: SLF001
        print(f"[4/4] AAPL conid={conid} precio_ref={px}")
    except Exception as exc:  # noqa: BLE001
        print(f"[4/4] no se pudo leer mercado (¿suscripción de datos?): {exc}")
        return 1

    print("\nTodo OK. La conexión funciona. DRY_RUN sigue en", settings.dry_run,
          "- ninguna orden se ha enviado.")
    print("Siguiente paso: probar una orden en PAPER antes de tocar DRY_RUN en live.")
    return 0


if __name__ == "__main__":
    import os

    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    # ibind registra un handler atexit que, si la sesión OAuth no llegó a crearse, revienta
    # con un traceback ruidoso al cerrar. os._exit evita ese cleanup (script de diagnóstico).
    os._exit(code)
