"""Horas del agente, en hora de Nueva York.
Se cambian con variables AGENTE_* sin tocar código."""

from __future__ import annotations

from datetime import time
from decimal import Decimal

from pydantic_settings import BaseSettings, SettingsConfigDict


class AgenteSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AGENTE_", extra="ignore")

    # Antes de la apertura, para vigilar las carteras con precios frescos.
    hora_vigia_previo: time = time(8, 45)
    # Unos minutos después de abrir la bolsa, con precios ya asentados.
    hora_ejecucion: time = time(9, 35)
    # Una hora antes del despertar: deja cargados los precios y fundamentales de la watchlist.
    hora_preparacion: time = time(16, 30)
    # Tras el cierre, cuando la fuente de precios ya tiene el día completo.
    hora_despertar: time = time(17, 30)
    # A las 23:30 de NY caería en hora punta de DeepSeek con el horario de verano.
    hora_consolidacion: time = time(19, 30)

    # Base propia del agente: pooler de sesión (puerto 5432), nunca el de transacciones.
    database_url: str = ""

    # Uuids de Supabase (los de Vennett) con acceso al panel, separados por comas.
    admin_ids: str = ""
    # Orígenes del panel para CORS, separados por comas.
    origenes: str = "http://localhost:3000"

    # Sin esto no hay ninguna llamada de pago.
    ia_activa: bool = False
    modelo: str = "deepseek-flash"
    # Bajo: menos vueltas sobre lo mismo; las cuentas y los datos ya los dan las herramientas.
    razonamiento: str = "low"
    razonamiento_revisor: str = "low"
    # Flash también para el revisor: el modelo Pro lo sirve Flash desde el 14-sep.
    modelo_revisor: str = "deepseek-flash"
    # Con True decide pero no crea órdenes.
    sombra: bool = False
    max_pasos: int = 8
    coste_estimado_llamada_usd: Decimal = Decimal("0.01")
    # Una respuesta con razonamiento alto tarda; más de esto es un proveedor colgado.
    timeout_llm_s: float = 120.0
    # Datos de empresa de Yahoo: la librería no deja fijar el tiempo, se corta desde fuera.
    timeout_yahoo_s: float = 20.0

    # Cortacircuitos solo sobre DeepSeek, el único servicio que cobra por llamada.
    interruptor_fallos: int = 3
    interruptor_pausa_min: int = 30

    # Despertares que se programa el propio agente, siempre en la revisión de después del cierre.
    # Subir estos topes es el paso al nivel 3.
    despertares_pendientes_max: int = 10
    despertares_semana_max: int = 5
    despertares_horizonte_dias: int = 60

    # Búsqueda de noticias con Brave. Sin clave la herramienta responde que no está configurada.
    brave_clave: str = ""
    busquedas_dia_max: int = 20
    timeout_busqueda_s: float = 10.0
    # Lo que cobra Brave por búsqueda en el plan contratado; en el gratuito, 0.
    coste_busqueda_usd: Decimal = Decimal("0")

    # Avisos a la campana del panel de Vennett. Sin URL o sin clave no se envían.
    vennett_url: str = ""
    vennett_clave_servicio: str = ""
    timeout_vennett_s: float = 10.0


ajustes = AgenteSettings()
