"""Motor de señales de la estrategia de momentum (zigzag / suelo múltiple / salida cierre→
apertura). Movido desde backend/scripts/backtest_canonico_momentum.py el 7-sep-2026 -- misma
lógica, sin reescribir. Ver docs/momentum-sala-real-x.md para el diseño completo.

Universo: 34 tickers en 6 sub-géneros (Espacio, IA infra, Quantum, Cripto-IA, Óptica-IA,
Biotech-IA). Ventana permanente: 2025-09-01 -> hoy (se refresca solo, usa la fecha real del
sistema).

Reglas de entrada:
- ZIGZAG: pivots de al menos 20% de reversal. Una entrada se dispara cuando el precio cae
  >=40% desde el ULTIMO PICO CONFIRMADO, y no se re-dispara hasta que se confirma un pico
  nuevo (una entrada por tramo -- "armado" se resetea solo con un pico posterior).
- SUELO MULTIPLE (doble, triple, o mas toques -- generalizado, no solo "doble"): los minimos
  zigzag se agrupan en clusters de precio similar (tolerancia 10%). Un cluster valido necesita
  2+ toques Y precio medio >=40% bajo el ATH real de la serie completa. El PRIMER toque de un
  cluster NUNCA es señal -- cada toque siguiente (2o, 3o, ...) es una entrada propia.
- Si una misma fecha+ticker produce zigzag Y suelo a la vez, se marca 'ambos'.

Salida: objetivo por tramos según el arranque de precio a 3 sesiones (flojo <5% -> +11%,
moderado 5-15% -> +27%, fuerte >=15% -> +40%), o tope de 90 días naturales, lo que llegue
antes. SIN stop-loss de precio. El cruce se DETECTA con el cierre; el precio que se registra
es la APERTURA del día siguiente (captura el sesgo overnight, ver doc §3).
"""
from __future__ import annotations

import time
from pathlib import Path

import pandas as pd
import yfinance as yf

UNIVERSO = ["ASTS", "RKLB", "LUNR", "FLY", "RDW", "VOYG", "GSAT", "ECHO", "VSAT", "PL",
            "NBIS", "CRWV", "APLD", "IREN", "SOUN", "IONQ", "QBTS", "RGTI", "ARQQ", "HQ",
            "CIFR", "HUT", "WULF", "BTDR", "CORZ",
            "LITE", "COHR", "FN", "POET", "AAOI",
            "RXRX", "TEM", "ABSI", "DNA"]
# Nota: los tickers incorporados desde el pipeline de descubrimiento (ApeWisdom -> filtros ->
# gate -> "Incorporar" tuyo) se añaden EN CALIENTE a esta lista y a SECTOR/NOMBRE de abajo --
# ver `momentum/candidatos.py:sincronizar_universo()`. Nunca hace falta tocar este archivo a
# mano para eso (decidido 8-sep-2026); esta lista es solo el núcleo curado por ETF/prensa.
SECTOR = {"ASTS": "Espacio", "RKLB": "Espacio", "LUNR": "Espacio", "FLY": "Espacio", "RDW": "Espacio",
          "VOYG": "Espacio", "GSAT": "Espacio", "ECHO": "Espacio", "VSAT": "Espacio", "PL": "Espacio",
          "NBIS": "IA infra", "CRWV": "IA infra", "APLD": "IA infra", "IREN": "IA infra", "SOUN": "IA infra",
          "IONQ": "Quantum", "QBTS": "Quantum", "RGTI": "Quantum", "ARQQ": "Quantum", "HQ": "Quantum",
          "CIFR": "Cripto-IA", "HUT": "Cripto-IA", "WULF": "Cripto-IA", "BTDR": "Cripto-IA", "CORZ": "Cripto-IA",
          "LITE": "Optica-IA", "COHR": "Optica-IA", "FN": "Optica-IA", "POET": "Optica-IA", "AAOI": "Optica-IA",
          "RXRX": "Biotech-IA", "TEM": "Biotech-IA", "ABSI": "Biotech-IA", "DNA": "Biotech-IA"}
NOMBRE = {
    "ASTS": "AST SpaceMobile", "RKLB": "Rocket Lab", "LUNR": "Intuitive Machines",
    "FLY": "Firefly Aerospace", "RDW": "Redwire", "VOYG": "Voyager Technologies",
    "GSAT": "Globalstar", "ECHO": "EchoStar", "VSAT": "Viasat", "PL": "Planet Labs",
    "NBIS": "Nebius", "CRWV": "CoreWeave", "APLD": "Applied Digital", "IREN": "IREN Limited",
    "SOUN": "SoundHound AI", "IONQ": "IonQ", "QBTS": "D-Wave Quantum", "RGTI": "Rigetti Computing",
    "ARQQ": "Arqit Quantum", "HQ": "Horizon Quantum",
    "CIFR": "Cipher Mining", "HUT": "Hut 8", "WULF": "TeraWulf", "BTDR": "Bitdeer Technologies",
    "CORZ": "Core Scientific",
    "LITE": "Lumentum", "COHR": "Coherent", "FN": "Fabrinet", "POET": "POET Technologies",
    "AAOI": "Applied Optoelectronics",
    "RXRX": "Recursion Pharmaceuticals", "TEM": "Tempus AI", "ABSI": "Absci", "DNA": "Ginkgo Bioworks",
}

# Ventana permanente -- NO tocar sin una decision explicita nueva (memoria 7-sep-2026: no se
# amplia mas atras a proposito, regimen de empresa distinto antes de estas fechas).
FETCH_START = "2025-07-01"
EVAL_START = pd.Timestamp("2025-09-01", tz="America/New_York")
REVERSAL_PCT = 0.20
ENTRY_TH = 0.40
SUELO_TOL = 0.10
SUELO_MIN_BAJO_ATH = 0.40
TOPE_DIAS = 90
CUIDADO_DIAS = 21  # p75 real de dias-a-objetivo entre las señales ganadoras


def precio_vivo(ticker: str) -> float | None:
    """Precio en vivo (con el retraso habitual de datos gratuitos) -- SOLO para mostrar de
    referencia en Alertas activas. Nunca entra en el cálculo de entrada/salida, que sigue
    siendo cierre->apertura siguiente (ver doc §3); esto es solo para que Manuel vea si el
    movimiento de HOY cambia lo que quiere hacer antes de que cierre el mercado."""
    try:
        p = yf.Ticker(ticker).fast_info.last_price
        return float(p) if p else None
    except Exception:
        return None


def fetch(ticker: str, intentos: int = 3) -> pd.DataFrame:
    """Descarga con reintento -- una descarga vacia por fallo puntual de red NUNCA debe
    interpretarse como 'sin señales' (bug real que costo caro con SOUN/ECHO)."""
    for _ in range(intentos):
        df = yf.Ticker(ticker).history(start=FETCH_START, interval="1d", auto_adjust=True)
        if df is not None and not df.empty:
            return df
        time.sleep(1.5)
    return pd.DataFrame()


def zigzag(precios: pd.Series, umbral: float) -> list[tuple]:
    """Pivots confirmados (fecha, precio, 'high'|'low'). Un pivot solo se confirma cuando
    el precio revierte >=umbral desde el, nunca antes -- asi se evita mirar al futuro."""
    pivots = []
    tendencia = None
    ref_precio, ref_fecha = precios.iloc[0], precios.index[0]
    for fecha, precio in precios.iloc[1:].items():
        if tendencia is None:
            cambio = (precio - precios.iloc[0]) / precios.iloc[0]
            if cambio >= umbral:
                tendencia, ref_precio, ref_fecha = "up", precio, fecha
            elif cambio <= -umbral:
                tendencia, ref_precio, ref_fecha = "down", precio, fecha
            continue
        if tendencia == "up":
            if precio > ref_precio:
                ref_precio, ref_fecha = precio, fecha
            elif (ref_precio - precio) / ref_precio >= umbral:
                pivots.append((ref_fecha, ref_precio, "high"))
                tendencia, ref_precio, ref_fecha = "down", precio, fecha
        else:
            if precio < ref_precio:
                ref_precio, ref_fecha = precio, fecha
            elif (precio - ref_precio) / ref_precio >= umbral:
                pivots.append((ref_fecha, ref_precio, "low"))
                tendencia, ref_precio, ref_fecha = "up", precio, fecha
    return pivots


def entradas_zigzag(precios: pd.Series, picos: list[tuple], umbral: float) -> list[dict]:
    """Una entrada por tramo: no se re-arma hasta que se confirma un pico NUEVO tras la
    ultima entrada."""
    pico_ref, pico_ref_fecha = precios.iloc[0], precios.index[0]
    ultimo_pico_usado = None
    salidas = []
    for fecha in precios.index:
        precio = precios.loc[fecha]
        confirmados = [(f, p) for f, p in picos if f <= fecha]
        if confirmados:
            pico_ref_fecha, pico_ref = max(confirmados, key=lambda x: x[0])
        en_curso = precios.loc[pico_ref_fecha:fecha].max()
        techo = max(pico_ref, en_curso)
        caida = precio / techo - 1
        if fecha < EVAL_START:
            continue
        armado = (ultimo_pico_usado is None) or (pico_ref_fecha > ultimo_pico_usado)
        if armado and caida <= -umbral:
            salidas.append({"entry_date": fecha, "entry_price": precio, "ref_price": techo,
                             "ref_date": pico_ref_fecha})
            ultimo_pico_usado = pico_ref_fecha
    return salidas


def agrupar_suelos(minimos: list[tuple], tolerancia: float) -> list[list[tuple]]:
    """Agrupa minimos de precio similar en clusters (doble, triple, N suelos -- sin limite).
    Un cluster de 1 solo toque no es un suelo confirmado, se descarta."""
    if len(minimos) < 2:
        return []
    ordenados = sorted(minimos, key=lambda x: x[1])
    clusters, actual = [], [ordenados[0]]
    for fecha, precio in ordenados[1:]:
        base = sum(p for _, p in actual) / len(actual)
        if (precio - base) / base <= tolerancia:
            actual.append((fecha, precio))
        else:
            clusters.append(actual)
            actual = [(fecha, precio)]
    clusters.append(actual)
    return [c for c in clusters if len(c) >= 2]


def objetivo_por_arranque(retorno_3_sesiones: float) -> float:
    if retorno_3_sesiones >= 15:
        return 0.40
    if retorno_3_sesiones >= 5:
        return 0.27
    return 0.11


def resolver_salida(precios: pd.Series, aperturas: pd.Series, fecha_entrada, precio_entrada: float) -> dict:
    """Camina dia a dia desde la entrada usando el CIERRE para detectar el cruce (objetivo o
    tope de 90 dias). Una vez detectado, el precio que se registra es la APERTURA del dia
    siguiente. Si el cruce se detecta el ULTIMO dia disponible, la señal se deja abierta un
    dia mas en vez de inventarse una apertura futura."""
    adelante = precios.loc[fecha_entrada:]
    if len(adelante) < 4:
        return {"resuelta": False, "exit_date": None, "ret": None, "motivo": None, "dias": None}
    ret_3_sesiones = (adelante.iloc[3] / precio_entrada - 1) * 100
    objetivo = objetivo_por_arranque(ret_3_sesiones)
    indices = adelante.index
    for i in range(1, len(indices)):
        fecha2 = indices[i]
        precio2 = adelante.loc[fecha2]
        dias_deteccion = (fecha2 - fecha_entrada).days
        disparo = None
        if precio2 / precio_entrada - 1 >= objetivo:
            disparo = "objetivo"
        elif dias_deteccion >= TOPE_DIAS:
            disparo = "tiempo"
        if disparo is None:
            continue
        if i + 1 >= len(indices):
            break  # detectado hoy mismo, sin apertura de manana todavia -- se queda abierta
        fecha_ejec = indices[i + 1]
        precio_ejec = aperturas.loc[fecha_ejec]
        return {"resuelta": True, "exit_date": fecha_ejec, "ret": (precio_ejec / precio_entrada - 1) * 100,
                "motivo": disparo, "dias": (fecha_ejec - fecha_entrada).days}
    precio_hoy = precios.iloc[-1]
    return {"resuelta": False, "exit_date": None, "ret": (precio_hoy / precio_entrada - 1) * 100,
            "motivo": None, "dias": (precios.index[-1] - fecha_entrada).days}


def señales_de_ticker(ticker: str) -> list[dict]:
    """Todas las señales (zigzag + suelo, con 'ambos' cuando coinciden) de un ticker. Función
    reutilizable: la usan tanto el job diario (universo fijo) como el escaneo de candidatos
    nuevos (tickers fuera del universo, ver momentum_candidatos)."""
    df = fetch(ticker)
    if df.empty:
        return []
    precios, aperturas = df["Close"], df["Open"]
    ath = precios.max()
    picos = zigzag(precios, REVERSAL_PCT)
    altos = [(f, p) for f, p, tipo in picos if tipo == "high"]
    bajos = [(f, p) for f, p, tipo in picos if tipo == "low"]
    sector = SECTOR.get(ticker, "—")

    señales = []
    for entrada in entradas_zigzag(precios, altos, ENTRY_TH):
        salida = resolver_salida(precios, aperturas, entrada["entry_date"], entrada["entry_price"])
        señales.append({
            "ticker": ticker, "sector": sector, "tipo": "zigzag",
            "entry_date": entrada["entry_date"], "entry_price": entrada["entry_price"],
            "ref_label": "pico_referencia", "ref_price": entrada["ref_price"],
            "caida_pct": -(entrada["entry_price"] / entrada["ref_price"] - 1) * 100,
            # ATH real de la serie (no el pico del tramo) + fecha del último pico confirmado:
            # es el contexto mínimo que necesita el gate de noticias (ver momentum/news_gate.py).
            "ath": ath, "desde_noticias": entrada["ref_date"],
            **salida,
        })
    for cluster in agrupar_suelos(bajos, SUELO_TOL):
        media = sum(p for _, p in cluster) / len(cluster)
        pct_bajo_ath = (1 - media / ath) * 100
        if pct_bajo_ath < SUELO_MIN_BAJO_ATH * 100:
            continue
        ordenado = sorted(cluster, key=lambda x: x[0])
        primer_toque_fecha = ordenado[0][0]
        for fecha, precio in ordenado[1:]:  # el primer toque nunca es señal
            if fecha < EVAL_START:
                continue
            salida = resolver_salida(precios, aperturas, fecha, precio)
            señales.append({
                "ticker": ticker, "sector": sector, "tipo": "suelo",
                "entry_date": fecha, "entry_price": precio,
                "ref_label": "ATH_referencia", "ref_price": ath,
                "caida_pct": pct_bajo_ath,
                # Sin "último pico" natural en un suelo -- se usa el primer toque del cluster
                # (inicio de la historia de esta caída) como ventana de noticias.
                "ath": ath, "desde_noticias": primer_toque_fecha,
                **salida,
            })
    return señales


def _combinar_ambos(señales: list[dict]) -> list[dict]:
    """Mismo ticker + misma fecha (zigzag y suelo coinciden) -> se marca 'ambos'."""
    if not señales:
        return []
    df = pd.DataFrame(señales)
    combinadas = []
    for _, grupo in df.groupby(["ticker", "entry_date"]):
        if len(grupo) == 1:
            combinadas.append(grupo.iloc[0].to_dict())
        else:
            base = grupo.iloc[0].to_dict()
            base["tipo"] = "ambos"
            base["caida_pct"] = grupo["caida_pct"].max()
            combinadas.append(base)
    return sorted(combinadas, key=lambda r: r["entry_date"], reverse=True)


def compute_signals(universo: list[str] | None = None) -> list[dict]:
    """Punto de entrada reutilizable: todas las señales del universo dado (por defecto, los
    34 fijos), con 'ambos' ya resuelto. Sin efectos secundarios (sin print, sin CSV) -- lo usa
    el job diario del scheduler."""
    universo = universo if universo is not None else UNIVERSO
    todas = []
    for ticker in universo:
        todas.extend(señales_de_ticker(ticker))
        time.sleep(0.12)
    return _combinar_ambos(todas)


if __name__ == "__main__":
    # CLI de siempre: igual comportamiento que backtest_canonico_momentum.py (imprime tabla +
    # agregados, escribe senales.csv). Solo para uso manual/análisis -- el job de producción
    # llama a compute_signals() directamente.
    import statistics
    from datetime import date, datetime
    import csv

    hoy_real = date.today()
    print(f"Ejecutado el {hoy_real.isoformat()} -- ventana {EVAL_START.date()} -> hoy\n")
    combinadas = compute_signals()
    resueltas = [r for r in combinadas if r["resuelta"]]
    abiertas = [r for r in combinadas if not r["resuelta"]]
    print(f"Total señales: {len(combinadas)}  resueltas: {len(resueltas)}  abiertas: {len(abiertas)}\n")

    print("=== Alertas activas (sin resolver), mas reciente primero ===")
    for r in abiertas:
        dias = (pd.Timestamp.now(tz="America/New_York") - r["entry_date"]).days
        cuidado = " [CUIDADO]" if dias > CUIDADO_DIAS else ""
        print(f"  {r['ticker']:5s} {r['tipo']:6s} {r['entry_date'].date()}  entrada ${r['entry_price']:.2f}  "
              f"caida {r['caida_pct']:.1f}%  hoy {r['ret']:+.1f}%  hace {dias}d{cuidado}")

    print("\n=== Agregados globales ===")
    if resueltas:
        rets = [r["ret"] for r in resueltas]
        print(f"  Resueltas: n={len(rets)} media={statistics.mean(rets):+.1f}% "
              f"mediana={statistics.median(rets):+.1f}% positivas={sum(1 for x in rets if x>0)/len(rets)*100:.0f}%")

    print("\n=== Validacion por ticker ===")
    for ticker in UNIVERSO:
        sub = [r for r in resueltas if r["ticker"] == ticker]
        if not sub:
            print(f"  {ticker}: 0 señales resueltas")
            continue
        rets = [r["ret"] for r in sub]
        print(f"  {ticker}: n={len(rets)} media={statistics.mean(rets):+.1f}% "
              f"pos={sum(1 for x in rets if x>0)/len(rets)*100:.0f}%")

    out_path = Path(__file__).parent.parent.parent / "scripts" / "senales.csv"
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        campos = ["ticker", "sector", "tipo", "entry_date", "entry_price", "ref_label", "ref_price",
                  "caida_pct", "resuelta", "exit_date", "ret", "motivo", "dias"]
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        for r in combinadas:
            fila = {k: r.get(k) for k in campos}
            fila["entry_date"] = r["entry_date"].date().isoformat()
            exit_val = r.get("exit_date")
            fila["exit_date"] = exit_val.date().isoformat() if pd.notna(exit_val) else ""
            w.writerow(fila)
    print(f"\nGuardado: {out_path} ({len(combinadas)} filas) -- generado el {datetime.now().isoformat()}")
