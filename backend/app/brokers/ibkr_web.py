"""Broker IBKR Web API — OAuth 1.0a headless vía `ibind` (sin gateway corriendo).

API verificada contra los ejemplos del repo de ibind (examples/rest_04_place_order.py,
rest_03_stock_querying.py, rest_05_marketdata_history.py, rest_08_oauth.py):
  - IbkrClient(cacert=..., use_oauth=True)  → sesión OAuth + tickle automáticos.
  - client.stock_conid_by_symbol(sym).data  → conid del contrato.
  - OrderRequest(conid, side, quantity, order_type='LMT', price, tif, acct_id, coid).
  - client.place_order(order, answers, acct_id).data  (answers = QuestionType→True).
  - client.marketdata_history_by_conid(conid, period, bar)  → precio de referencia.
  - client.check_health()  → sesión viva.

Credenciales: 7 variables IBIND_* (se vuelcan desde nuestra config). Requiere alta previa en
el Self-Service OAuth de IBKR (cuenta individual Pro). Ver secrets/ibkr/HANDOFF.md.

NOTA: escrito y listo, pero SIN validar contra la API real hasta que existan credenciales
activas (IBKR tarda 24h-2 semanas en activar). Hasta entonces la factory usa DryRunBroker.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from decimal import Decimal

from app.brokers.base import BrokerResult
from app.config import settings
from app.ledger.money import D, to_cents

logger = logging.getLogger(__name__)


def credentials_present() -> bool:
    """True si están las 7 credenciales OAuth de ibind configuradas."""
    return all([
        settings.ibkr_account_id,
        settings.ibkr_oauth_consumer_key,
        settings.ibkr_oauth_access_token,
        settings.ibkr_oauth_access_token_secret,
        settings.ibkr_oauth_signature_key_path,
        settings.ibkr_oauth_encryption_key_path,
        settings.ibkr_oauth_dh_prime,
    ])


def materialize_pems(dest_dir: str | None = None) -> bool:
    """Vuelca las claves PEM subidas en BASE64 (env, para la nube) a ficheros y apunta las rutas.

    En Railway los `.pem` no existen en disco (no viajan por git): van como env vars en base64
    (`IBKR_PEM_*_B64`). Al arrancar, esto los escribe en un directorio temporal con permisos
    restrictivos y sobrescribe `ibkr_oauth_*_key_path` para que ibind los encuentre. Best-effort:
    si algo falla, log y False — el broker cae en DryRun por la cascada de seguridad, nunca
    tumba el arranque. En local (sin B64) es un no-op y se usan las rutas del .env.
    """
    import base64
    import pathlib
    import tempfile

    pairs = [
        (settings.ibkr_pem_signature_b64, "private_signature.pem",
         "ibkr_oauth_signature_key_path"),
        (settings.ibkr_pem_encryption_b64, "private_encryption.pem",
         "ibkr_oauth_encryption_key_path"),
    ]
    if not any(b64 for b64, _f, _a in pairs):
        return False                                    # local: no hay nada que materializar
    try:
        out = (pathlib.Path(dest_dir) if dest_dir
               else pathlib.Path(tempfile.gettempdir()) / "ibkr_keys")
        out.mkdir(parents=True, exist_ok=True)
        os.chmod(out, 0o700)
        for b64, fname, attr in pairs:
            if not b64:
                continue
            path = out / fname
            path.write_bytes(base64.b64decode(b64, validate=True))
            os.chmod(path, 0o600)
            setattr(settings, attr, str(path))
        logger.info("Claves IBKR materializadas desde env en %s", out)
        return True
    except Exception:
        logger.exception("No se pudieron materializar las claves IBKR (broker quedará simulado).")
        return False


def _export_env() -> None:
    """Vuelca la config tipada a las env vars IBIND_* que lee ibind."""
    os.environ["IBIND_USE_OAUTH"] = "True"
    os.environ["IBIND_OAUTH1A_CONSUMER_KEY"] = settings.ibkr_oauth_consumer_key
    os.environ["IBIND_OAUTH1A_ACCESS_TOKEN"] = settings.ibkr_oauth_access_token
    os.environ["IBIND_OAUTH1A_ACCESS_TOKEN_SECRET"] = settings.ibkr_oauth_access_token_secret
    os.environ["IBIND_OAUTH1A_SIGNATURE_KEY_FP"] = settings.ibkr_oauth_signature_key_path
    os.environ["IBIND_OAUTH1A_ENCRYPTION_KEY_FP"] = settings.ibkr_oauth_encryption_key_path
    os.environ["IBIND_OAUTH1A_DH_PRIME"] = settings.ibkr_oauth_dh_prime


class IbkrWebBroker:
    name = "ibkr-web"
    is_live = True

    def __init__(self) -> None:
        _export_env()
        from ibind import IbkrClient  # lazy: solo si hay credenciales

        # cacert: por defecto False (sin verificación) — coherente con el problema de TLS de
        # Avast en esta máquina. Para verificar, exporta IBIND_CACERT con la ruta del bundle.
        cacert = os.getenv("IBIND_CACERT", "false")
        cacert = False if str(cacert).lower() in ("false", "0", "") else cacert
        # timeout/max_retries EXPLÍCITOS: ninguna llamada REST puede colgarse — peor caso
        # ~8s×2 por llamada. Con el deadline del sondeo, ningún método del broker se cuelga.
        self._client = IbkrClient(cacert=cacert, use_oauth=True, timeout=8, max_retries=2)
        self._account = settings.ibkr_account_id

    def _conid(self, ticker: str) -> int:
        """Resuelve el conid del contrato de acción US. Lanza si no es único/no existe."""
        data = self._client.stock_conid_by_symbol(ticker).data
        # ibind puede devolver {symbol: conid} o el conid directo según versión.
        conid = data.get(ticker) if isinstance(data, dict) else data
        if conid is None:
            raise RuntimeError(f"No se encontró conid para {ticker}.")
        return int(conid)

    def _reference_price(self, conid: int) -> Decimal | None:
        """Último cierre como precio de referencia (best-effort). El fill REAL vendrá de la
        orden (Fase 4: polling del estado). Aquí solo alimentamos el libro con una estimación."""
        try:
            hist = self._client.marketdata_history_by_conid(
                str(conid), period="1d", bar="1d", outside_rth=True
            ).data
            bars = hist.get("data") if isinstance(hist, dict) else hist
            if bars:
                last = bars[-1]
                px = last.get("c") if isinstance(last, dict) else None
                return to_cents(D(str(px))) if px is not None else None
        except Exception:
            logger.warning("No se pudo obtener precio de referencia para conid %s", conid)
        return None

    def place_order(self, ticker: str, side: str, quantity: Decimal, order_ref: str = "") -> BrokerResult:
        """Orden LÍMITE ya aprobada por el usuario (NUNCA a mercado). side: 'buy' | 'sell'.

        El límite se fija sobre el precio de referencia de IBKR ± `limit_buffer_pct` (límite
        ejecutable): entra al precio actual pero nunca peor que ese tope. Sin referencia de
        precio NO se envía nada (mejor no ejecutar que mandar una orden a ciegas).
        """
        try:
            from ibind import QuestionType
            from ibind.client.ibkr_utils import OrderRequest

            from app.brokers.base import marketable_limit

            conid = self._conid(ticker)
            reference = self._reference_price(conid)
            if reference is None:
                return BrokerResult(ok=False, fill_price=None, simulated=False,
                                    message=f"Sin precio de referencia para {ticker}; no se envía "
                                            "la orden límite (evita ejecutar a ciegas).")
            limit = marketable_limit(reference, side, settings.limit_buffer_pct)
            order = OrderRequest(
                conid=conid,
                side=side.upper(),                 # BUY | SELL
                quantity=float(quantity),          # la API pide float; el LIBRO guarda Decimal
                order_type="LMT",
                price=float(limit),                # precio límite
                tif="DAY",                         # válida durante la sesión
                acct_id=self._account,
                coid=(order_ref or f"AT-{uuid.uuid4().hex[:8]}")[:40],  # atribución/idempotencia
            )
            # "Preguntas" de precaución de IBKR: las aceptamos porque la decisión humana ya se
            # tomó en la aprobación explícita (el Sí de la Sala Real).
            answers = {
                QuestionType.PRICE_PERCENTAGE_CONSTRAINT: True,
                QuestionType.ORDER_VALUE_LIMIT: True,
            }
            resp = self._client.place_order(order, answers, self._account).data
            order_id = ""
            if resp and isinstance(resp, list) and isinstance(resp[0], dict):
                order_id = str(resp[0].get("order_id") or resp[0].get("orderId") or "")

            # Sondea el estado hasta que ejecute/rechace o se agote el tiempo → deja el fill REAL.
            # Ritmo 1.5s (muy por debajo del rate limit de IBKR, ~10 req/s) y deadline duro:
            # este método TERMINA SIEMPRE en ≤ order_poll_seconds aunque la orden siga viva.
            deadline = time.time() + max(0, settings.order_poll_seconds)
            last: BrokerResult | None = None
            while order_id and time.time() < deadline:
                last = self.poll_order(order_id)
                if last.status in ("filled", "rejected"):
                    break
                time.sleep(1.5)

            if last is not None and last.status in ("filled", "partial", "rejected"):
                return last  # fill (o rechazo) confirmado por IBKR
            # Enviada pero aún trabajando (o sin poder sondear): se reconcilia después.
            return BrokerResult(
                ok=True, fill_price=None, simulated=False, status="working",
                order_id=order_id or None,
                message=f"IBKR orden {order_id or '?'} enviada LÍMITE ${limit} "
                        f"({side} {quantity} {ticker}) — esperando ejecución.",
            )
        except Exception as exc:  # noqa: BLE001 — el error debe llegar legible al panel
            logger.exception("Fallo enviando orden a IBKR")
            return BrokerResult(ok=False, fill_price=None, simulated=False, status="rejected",
                                message=f"IBKR error: {exc}")

    # --- Reconciliación de estado de orden ------------------------------------

    _FILLED = {"filled"}
    _DEAD = {"cancelled", "canceled", "apicancelled", "pendingcancel", "rejected",
             "inactive", "expired"}

    @staticmethod
    def _num(o: dict, *keys: str):
        for k in keys:
            v = o.get(k)
            if v not in (None, ""):
                try:
                    return Decimal(str(v))
                except (ValueError, ArithmeticError):
                    pass
        return None

    def _fetch_order(self, order_id: str) -> dict | None:
        """Busca la orden por id en IBKR (best-effort, tolerante a variaciones de la API)."""
        fn = getattr(self._client, "order_status", None)
        if fn is not None:
            try:
                data = fn(order_id).data
                if isinstance(data, dict) and data:
                    return data
            except Exception:  # noqa: BLE001
                pass
        try:
            data = self._client.live_orders().data
            orders = data.get("orders") if isinstance(data, dict) else data
            for o in orders or []:
                if str(o.get("orderId") or o.get("order_id") or o.get("id")) == str(order_id):
                    return o
        except Exception:  # noqa: BLE001
            logger.warning("No se pudieron leer las órdenes vivas de IBKR")
        return None

    def poll_order(self, order_id: str) -> BrokerResult:
        """Estado actual de una orden en IBKR → BrokerResult (para reconciliar 'working')."""
        o = self._fetch_order(order_id)
        if o is None:
            return BrokerResult(ok=True, fill_price=None, simulated=False, status="working",
                                order_id=order_id, message=f"Orden {order_id}: sin datos aún.")
        raw = str(o.get("status") or o.get("order_status") or o.get("orderStatus") or "").lower().strip()
        filled = self._num(o, "filledQuantity", "filled_quantity", "cumQuantity", "filled")
        avg = self._num(o, "avgPrice", "avg_price", "average_price", "avgprice")
        if raw in self._FILLED:
            status = "filled"
        elif raw in self._DEAD:
            status = "rejected"
        elif filled and filled > 0:
            status = "partial"
        else:
            status = "working"
        label = {"filled": "ejecutada", "partial": "ejecución parcial",
                 "working": "trabajando", "rejected": "rechazada/cancelada"}[status]
        detail = f" {filled}@${to_cents(avg)}" if (filled and avg is not None) else ""
        return BrokerResult(
            ok=(status != "rejected"), fill_price=avg, simulated=False, status=status,
            order_id=order_id, filled_quantity=filled,
            message=f"IBKR orden {order_id}: {label}{detail}.",
        )

    def raw_positions(self) -> list[dict]:
        """Posiciones BRUTAS de la cuenta IBKR (read-only, incluye las personales del usuario).

        SOLO para el snapshot de cartera personal (/personal/sync). El agente JAMÁS usa esto
        para dimensionar ni vender: su única fuente es su propio libro (book='real').
        """
        data = self._client.positions(self._account).data
        return [p for p in (data or []) if isinstance(p, dict)]

    def status(self) -> dict:
        try:
            healthy = bool(self._client.check_health())
            return {
                "mode": "live", "live": True,
                "detail": (f"IBKR Web API conectado (cuenta {self._account})." if healthy
                           else "IBKR Web API: sesión no saludable (revisa credenciales/activación)."),
            }
        except Exception as exc:  # noqa: BLE001
            return {"mode": "live", "live": True, "detail": f"IBKR sin conexión: {exc}"}
