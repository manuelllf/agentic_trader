"""IndexNow: avisa a Bing y a los buscadores que lo admiten de las páginas nuevas, al momento.

Google no lo usa. Los avisos nunca rompen a quien los pide: un fallo se anota y se sigue.
`python -m app.indexnow` manda de una vez todo el sitemap."""

from __future__ import annotations

import html
import logging
import re
from urllib.parse import quote, urlparse

import httpx
from sqlalchemy import text

from app.config import settings
from app.liga import gestion
from app.liga.procesos.comun import auditar, auditar_fallo, fabrica_sistema, sesion

logger = logging.getLogger(__name__)

ENDPOINT = "https://api.indexnow.org/indexnow"
AJUSTE = "procesos.indexnow.auto"
MAX_URLS = 10_000  # tope de IndexNow por petición
_ACEPTADAS = (200, 202)  # 202: la clave se valida después


def _base() -> str:
    return settings.url_publica.rstrip("/")


def enviar(urls: list[str]) -> bool:
    """Manda las URLs de nuestro dominio a IndexNow; True si las aceptó todas. No lanza."""
    base = _base()
    clave = settings.indexnow_clave
    propias = list(dict.fromkeys(u for u in urls if u == base or u.startswith(base + "/")))
    if not clave or not propias:
        return False
    host = urlparse(base).hostname
    aceptado = True
    for i in range(0, len(propias), MAX_URLS):
        cuerpo = {"host": host, "key": clave, "keyLocation": f"{base}/{clave}.txt",
                  "urlList": propias[i:i + MAX_URLS]}
        try:
            r = httpx.post(ENDPOINT, json=cuerpo, timeout=10)
        except httpx.HTTPError:
            logger.warning("IndexNow no respondió")
            aceptado = False
            continue
        if r.status_code not in _ACEPTADAS:
            logger.warning("IndexNow rechazó el aviso (%s)", r.status_code)
            aceptado = False
    return aceptado


def avisar(urls: list[str]) -> bool:
    """Como `enviar`, pero solo con el interruptor del admin encendido. No lanza."""
    if not settings.indexnow_clave:
        return False
    try:
        if not gestion._ajuste_booleano(AJUSTE, True):
            return False
        return enviar(urls)
    except Exception:
        logger.exception("Aviso a IndexNow fallido")
        return False


def urls_de_articulos(slugs: list[str]) -> list[str]:
    """Cada artículo en sus dos idiomas y los dos listados, que cambian con él."""
    base = _base()
    urls = [f"{base}/blog", f"{base}/en/blog"]
    for slug in slugs:
        seguro = quote(slug, safe="")
        urls += [f"{base}/blog/{seguro}", f"{base}/en/blog/{seguro}"]
    return urls


def urls_del_criptico(db, dia) -> list[str]:  # noqa: ANN001
    """El acertijo publicado de ese día en cada idioma y las dos portadas del críptico."""
    base = _base()
    urls = [f"{base}/criptico", f"{base}/en/criptico"]
    filas = db.execute(text("select idioma, numero from criptico.acertijos "
                            "where dia = :dia and estado = 'publicado' order by idioma, numero"),
                       {"dia": dia}).all()
    for idioma, numero in filas:
        urls.append(f"{base}{'/en' if idioma == 'en' else ''}/criptico/{int(numero)}")
    return urls


def job_criptico():
    """Pasada la medianoche de Madrid: el acertijo del día ya se ve, se avisa de él."""
    from app.criptico.logica import hoy_madrid

    try:
        with sesion(fabrica_sistema) as db:
            urls = urls_del_criptico(db, hoy_madrid())
        aceptado = avisar(urls)
        with sesion(fabrica_sistema) as db:
            auditar(db, "indexnow.criptico", None, {"urls": len(urls), "aceptado": aceptado}, None)
            db.commit()
        return aceptado
    except Exception:
        auditar_fallo(fabrica_sistema, "indexnow_criptico", None,
                      RuntimeError("Fallo del aviso del críptico a IndexNow"), None)


def urls_del_sitemap() -> list[str]:
    """Todas las URLs del sitemap público."""
    r = httpx.get(f"{_base()}/sitemap.xml", timeout=20, follow_redirects=True)
    r.raise_for_status()
    return [html.unescape(u) for u in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", r.text)]


def enviar_sitemap() -> tuple[int, bool]:
    """Avisa de todo el sitemap de una vez (tras un despliegue con páginas nuevas)."""
    urls = urls_del_sitemap()
    return len(urls), enviar(urls)


if __name__ == "__main__":
    n, ok = enviar_sitemap()
    print(f"{n} URLs del sitemap: {'aceptadas' if ok else 'NO aceptadas'}")
