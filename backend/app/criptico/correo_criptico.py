"""Correo bilingüe del críptico; solo ayer lleva solución."""

from html import escape

from app import correo_plantilla as plantilla
from app.config import settings
from app.i18n import translate


def _pista(acertijo) -> str:
    pista = acertijo["pista"]
    texto = pista if isinstance(pista, str) else "".join(p["texto"] for p in pista)
    return " ".join(texto.replace("[[", "").replace("]]", "").split())


def render(*, idioma, acertijo, ayer, url_baja, url_resolver,
           n_media_ayer) -> tuple[str, str, str]:
    def t(clave, **valores):
        return translate("criptico_" + clave, idioma, **valores)

    pista = _pista(acertijo)
    numero, longitud = acertijo["numero"], acertijo["longitud"]
    asunto = t("asunto", numero=numero, pista=pista)
    titulo = t("titulo", numero=numero)
    meta = t("meta", fecha=acertijo["dia"].strftime(t("formato_fecha")),
             nivel=t("nivel_" + acertijo["nivel"]))
    preheader = t("preheader_ayer", respuesta=ayer["respuesta"]) if ayer else ""
    enlace, baja, legal = t("resolver"), t("baja"), t("no_recomendacion")
    ayer_texto, ayer_html = "", ""
    e = escape
    if ayer:
        ayer_titulo = t("de_ayer")
        ayer_pista = f'{_pista(ayer)} ({ayer["longitud"]})'
        media = ""
        if n_media_ayer is not None:
            promedio = f'{ayer["media"]:.1f}'
            if idioma == "es":
                promedio = promedio.replace(".", ",")
            media = t("media_ayer", count=n_media_ayer, media=promedio)
        ayer_texto = "\n".join(p for p in (
            f"{ayer_titulo}: {ayer_pista}", ayer["respuesta"], ayer["resolucion"],
            ayer["concepto"], media) if p)
        ayer_html = (
            '<div class="linea" style="border-top:1px solid #DCE4E4;padding-top:18px;">'
            f'<p class="gris" style="{plantilla._META}">{e(ayer_titulo)} · '
            f'{e(ayer_pista)}</p>'
            f'<p class="tinta" style="{plantilla._H1}">{e(ayer["respuesta"])}</p>'
            f'<p class="tinta2" style="{plantilla._INTRO}">{e(ayer["resolucion"])}</p>'
            f'<p class="tinta2" style="{plantilla._INTRO}">{e(ayer["concepto"])}</p>'
            + (f'<p class="gris" style="{plantilla._META}">{e(media)}</p>' if media else "")
            + '</div>')
    texto = "\n\n".join(p for p in (
        asunto, meta, f'{pista} ({longitud})\n' + " ".join("_" for _ in range(longitud)),
        f"{enlace}: {url_resolver}", ayer_texto, f"{legal}\n{baja}: {url_baja}") if p) + "\n"
    casillas = "".join(
        '<td class="hoja linea" style="width:26px;height:34px;border:1px solid #CFD3D8;'
        'background:#FFFFFF;"></td>' for _ in range(longitud))
    html = "\n".join([
        '<!doctype html>', f'<html lang="{e(idioma)}"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="color-scheme" content="light dark">',
        '<meta name="supported-color-schemes" content="light dark">',
        f'<title>{e(asunto)}</title><style>{plantilla._OSCURO}</style></head>',
        '<body class="fondo" style="margin:0;padding:0;background:#EEF3F3;">',
        (f'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">'
         f'{e(preheader)}</div>') if preheader else "",
        f'<table {plantilla._PRES} class="fondo" style="background:#EEF3F3;">',
        '<tr><td align="center" style="padding:24px 12px;">',
        f'<table {plantilla._PRES} class="hoja" '
        'style="max-width:600px;background:#FFFFFF;border-radius:6px;">',
        f'<tr><td style="padding:28px 28px 24px;{plantilla._LETRA}">',
        plantilla._logo(settings.url_publica),
        f'<h1 class="tinta" style="{plantilla._H1}">{e(titulo)}</h1>',
        f'<p class="gris" style="{plantilla._META}">{e(meta)}</p>',
        '<p class="tinta" style="margin:0 0 16px;font-size:22px;line-height:1.35;'
        f'font-weight:600;color:#111315;">{e(pista)} ({e(str(longitud))})</p>',
        '<table role="presentation" cellpadding="0" cellspacing="4" '
        f'style="margin:0 0 22px;"><tr>{casillas}</tr></table>',
        '<p style="margin:0 0 26px;font-size:15px;line-height:1.6;">'
        f'<a class="enlace" href="{e(url_resolver)}" style="{plantilla._ENLACE}">'
        f'{e(enlace)}</a></p>', ayer_html,
        f'<p class="gris linea" style="{plantilla._PIE}">{e(legal)}<br>'
        f'<a class="gris" href="{e(url_baja)}" style="color:#646D76;">{e(baja)}</a></p>',
        '</td></tr></table></td></tr></table></body></html>', ""])
    return asunto, texto, html
