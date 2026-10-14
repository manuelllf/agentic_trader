"""Plantilla de los correos de Vennett: HTML con la marca y su versión en texto.

Sin imágenes de seguimiento ni botones de venta y con un solo enlace al contenido, para que se lea
como un aviso y no como publicidad. Los textos llegan ya traducidos; aquí solo se escapan y colocan.
El logo son dos PNG de `frontend/public/correo` (los clientes de correo no muestran SVG)."""

from __future__ import annotations

from collections.abc import Sequence
from html import escape

from app.config import settings

Fila = tuple[str, str | None]  # ticker y su detalle (el tipo de señal), si lo tiene

_PRES = 'role="presentation" width="100%" cellpadding="0" cellspacing="0"'
_LETRA = "font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;"
_CELDA = "padding:7px 12px 7px 0;border-bottom:1px solid #EEF3F3;font-size:14px;"
_H1 = "margin:0 0 6px;font-size:20px;line-height:1.3;font-weight:600;color:#111315;"
_META = "margin:0 0 20px;font-size:13px;line-height:1.5;color:#646D76;"
_INTRO = "margin:0 0 16px;font-size:15px;line-height:1.6;color:#41464C;"
_ENLACE = "color:#0B6E68;font-weight:600;text-decoration:underline;"
_PIE = ("margin:24px 0 0;padding-top:14px;border-top:1px solid #DCE4E4;font-size:12px;"
        "line-height:1.55;color:#646D76;")
# Tema oscuro para los clientes que lo leen (Apple Mail, Outlook nuevo); Gmail se queda en el claro.
_OSCURO = """  @media (prefers-color-scheme: dark) {
    .fondo { background: #0E1214 !important; }
    .hoja { background: #161A1D !important; }
    .tinta { color: #F3F4F4 !important; }
    .tinta2 { color: #C9CDD1 !important; }
    .gris { color: #9AA1A8 !important; }
    .enlace { color: #4FA39D !important; }
    .linea { border-color: #2A2F34 !important; }
    .marca-clara { display: none !important; }
    .marca-oscura { display: block !important; max-height: none !important; }
  }"""


def _tabla(filas: Sequence[Fila], columnas: tuple[str, str]) -> str:
    con_detalle = any(detalle for _, detalle in filas)
    por_fila = 2 if con_detalle else 4
    html = []
    if con_detalle:
        cabecera = "".join(
            f'<th align="left" class="gris linea" style="padding:0 12px 6px 0;font-size:12px;'
            f'font-weight:500;color:#646D76;border-bottom:1px solid #DCE4E4;">{escape(c)}</th>'
            for c in columnas) * por_fila
        html.append(f"<tr>{cabecera}</tr>")
    for i in range(0, len(filas), por_fila):
        celdas = []
        for ticker, detalle in filas[i:i + por_fila]:
            celdas.append(f'<td class="tinta linea" style="{_CELDA}font-weight:600;color:#111315;">'
                          f"{escape(ticker)}</td>")
            if con_detalle:
                celdas.append(f'<td class="gris linea" style="{_CELDA}color:#646D76;">'
                              f"{escape(detalle or '')}</td>")
        html.append(f"<tr>{''.join(celdas)}</tr>")
    return (f'<table {_PRES} style="border-collapse:collapse;margin:0 0 20px;">'
            f'{"".join(html)}</table>')


def _logo(base: str, variante: str, alt: str, estilo: str) -> str:
    return (f'<img class="marca-{variante}" src="{escape(base)}/correo/marca-{variante}.png" '
            f'width="132" height="28" alt="{alt}" style="{estilo}border:0;margin:0 0 28px;">')


def render(*, idioma: str, asunto: str, meta: str, intro: str, filas: Sequence[Fila],
           columnas: tuple[str, str], enlace_texto: str, ruta: str, pie: str,
           ajustes_texto: str, legal_texto: str) -> tuple[str, str]:
    """Devuelve (texto, html) del correo."""
    base = settings.url_publica
    enlace, ajustes, legal = base + ruta, base + "/cuenta/avisos", base + "/legal/aviso"
    lista = ", ".join(f"{t} ({d})" if d else t for t, d in filas)
    dominio = base.removeprefix("https://")
    texto = "\n\n".join(p for p in (
        asunto, meta, intro, lista, f"{enlace_texto}: {enlace}",
        f"{pie}\n{ajustes_texto}: {ajustes}\nVennett · {dominio}") if p) + "\n"
    e = escape
    html = "\n".join([
        "<!doctype html>",
        f'<html lang="{e(idioma)}">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="color-scheme" content="light dark">',
        '<meta name="supported-color-schemes" content="light dark">',
        f"<title>{e(asunto)}</title>",
        f"<style>\n{_OSCURO}\n</style>",
        "</head>",
        '<body class="fondo" style="margin:0;padding:0;background:#EEF3F3;">',
        f'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">{e(intro)}</div>',
        f'<table {_PRES} class="fondo" style="background:#EEF3F3;">',
        '<tr><td align="center" style="padding:24px 12px;">',
        f'<table {_PRES} class="hoja" '
        'style="max-width:600px;background:#FFFFFF;border-radius:6px;">',
        f'<tr><td style="padding:28px 28px 24px;{_LETRA}">',
        _logo(base, "clara", "Vennett", "display:block;"),
        _logo(base, "oscura", "", "display:none;max-height:0;overflow:hidden;mso-hide:all;"),
        f'<h1 class="tinta" style="{_H1}">{e(asunto)}</h1>',
        f'<p class="gris" style="{_META}">{e(meta)}</p>',
        f'<p class="tinta2" style="{_INTRO}">{e(intro)}</p>',
        _tabla(filas, columnas) if filas else "",
        '<p style="margin:0;font-size:15px;line-height:1.6;">'
        f'<a class="enlace" href="{e(enlace)}" style="{_ENLACE}">{e(enlace_texto)}</a></p>',
        f'<p class="gris linea" style="{_PIE}">{e(pie)}<br>',
        f'<a class="gris" href="{e(ajustes)}" style="color:#646D76;">{e(ajustes_texto)}</a> · '
        f'<a class="gris" href="{e(legal)}" style="color:#646D76;">{e(legal_texto)}</a></p>',
        "</td></tr>", "</table>", "</td></tr>", "</table>", "</body>", "</html>", ""])
    return texto, html
