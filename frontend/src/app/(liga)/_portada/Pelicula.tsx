"use client";

// La escena de la portada: el lienzo y sus capas de texto. El movimiento lo lleva `montarPelicula`;
// aquí solo está el esqueleto con los textos del catálogo.

import { localeTag } from "@/i18n/locale";
import type { EstadoCriptico } from "@/lib/criptico/estado";
import { PLANES_VISIBLES } from "@/lib/liga/planes";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { miles } from "@/lib/liga/format";
import { montarPelicula } from "./pelicula/motor";
import { PER_MAX, PER_MIN, PESOS, UMBRALES, UNIVERSO } from "./pelicula/universo";

/** Parte la tesis en trozos y marca los que se convierten en regla (si la traducción los contiene). */
function trocear(tesis: string, frases: string[]): { texto: string; k: number | null }[] {
  const marcas = frases.map((f, k) => ({ k, a: tesis.indexOf(f), b: tesis.indexOf(f) + f.length }))
    .filter((m) => m.a >= 0).sort((x, y) => x.a - y.a);
  const trozos: { texto: string; k: number | null }[] = [];
  let i = 0;
  for (const m of marcas) {
    if (m.a < i) continue;
    if (m.a > i) trozos.push({ texto: tesis.slice(i, m.a), k: null });
    trozos.push({ texto: tesis.slice(m.a, m.b), k: m.k });
    i = m.b;
  }
  if (i < tesis.length) trozos.push({ texto: tesis.slice(i), k: null });
  return trozos;
}

const letras = (texto: string, desde: number) =>
  [...texto].map((c, i) => <span key={desde + i} className="c">{c}</span>);

const fechaCorta = (fecha: string, locale: string) =>
  new Intl.DateTimeFormat(localeTag(locale), { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${fecha}T00:00:00Z`));

export function Pelicula({ criptico }: { criptico: EstadoCriptico }) {
  const t = useTranslations();
  const locale = useLocale() === "en" ? "en" : "es";
  const raiz = useRef<HTMLDivElement>(null);
  const legal = useRef<HTMLDivElement>(null);
  const [legalAbierto, setLegalAbierto] = useState(false);

  const [tema, setTema] = useState<"claro" | "oscuro" | null>(null);

  useEffect(() => {
    const preferencia = window.matchMedia("(prefers-color-scheme: dark)");
    const actualizar = () => {
      const elegido = document.documentElement.dataset.theme;
      setTema(elegido === "light" ? "claro" : elegido === "dark" ? "oscuro" : preferencia.matches ? "oscuro" : "claro");
    };
    const observador = new MutationObserver(actualizar);
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    preferencia.addEventListener("change", actualizar);
    actualizar();
    return () => {
      observador.disconnect();
      preferencia.removeEventListener("change", actualizar);
    };
  }, []);

  useEffect(() => {
    if (tema === null || !raiz.current) return;
    return montarPelicula(raiz.current, { locale, t: (clave, valores) => t(clave, valores) }, tema);
  }, [locale, t, tema]);

  // El panel legal del móvil se cierra al tocar fuera.
  useEffect(() => {
    if (!legalAbierto) return;
    const fuera = (ev: PointerEvent) => { if (!legal.current?.contains(ev.target as Node)) setLegalAbierto(false); };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [legalAbierto]);

  const tesis = t("landing_tesis");
  let cursor = 0;
  const trozos = trocear(tesis, [1, 2, 3, 4].map((k) => t(`landing_tesis_frase_${k}`))).map((trozo, i) => {
    const hijos = letras(trozo.texto, cursor);
    cursor += trozo.texto.length;
    return trozo.k == null ? hijos : <span key={`f${i}`} className="ph" data-k={trozo.k}>{hijos}</span>;
  });
  const reglas = [
    [t("landing_regla_rentables"), t("landing_regla_valor_roe", { valor: UMBRALES.roe })],
    [t("landing_regla_ventas"), t("landing_regla_valor_ventas", { valor: UMBRALES.ventas })],
    [t("landing_regla_deuda"), t("landing_regla_valor_deuda", { valor: UMBRALES.deuda })],
  ];
  const pesos = ["strategies_weight_business", "strategies_weight_price", "strategies_weight_debt",
    "strategies_weight_catalyst"].map((clave, k) => ({ nombre: t(clave), peso: PESOS[k] }));

  return (
    <div ref={raiz} className="pel">
      <section className="pel-film" aria-labelledby="pel-titulo">
        <div data-p="escena" className="pel-escena">
          <canvas data-p="lienzo" aria-hidden="true" />
          <div className="pel-fx pel-vineta" />
          <div data-p="grano" className="pel-fx pel-grano" />

          <div className="pel-capas">
            <div data-p="visor" className="pel-visor" aria-hidden="true"><i /><i /><i /><i /></div>

            <div data-p="franja" className="pel-franja">
              <div data-it="cierre" className="pel-it">
                <div className="pel-ceja-linea"><span className="pel-ceja">{t("landing_foto_ceja")}</span>
                  <div data-p="reloj" className="pel-reloj"><span className="pel-punto" /><span data-p="relojTxt" /></div>
                </div>
                <p className="pel-frase">{t("landing_foto_frase")}
                  <small>{t("landing_foto_sub", { cuantas: miles(UNIVERSO, locale) })}</small></p>
              </div>
              <div data-it="tesis" className="pel-it pel-tesis">
                <span className="pel-ceja">{t("landing_tu_idea")}</span>
                <p data-p="tesis">{trozos}</p>
              </div>
              <div data-it="reglas" className="pel-it">
                <div className="pel-ceja-linea"><span className="pel-ceja">{t("landing_tus_reglas")}</span>
                  <div data-p="recuento" className="pel-recuento"><b data-p="recuentoN" /><span data-p="recuentoL" /></div>
                </div>
                <ol className="pel-reglas">
                  {reglas.map(([nombre, valor]) => (
                    <li key={nombre} data-p="regla"><span className="rt">{nombre}</span><span className="rv">{valor}</span>
                      <span className="rd" data-p="reglaCuenta" /></li>
                  ))}
                  <li data-p="regla" className="per"><span className="rt">{t("landing_regla_barata")}</span>
                    <span className="rv" data-p="perTxt" /><span className="rd" data-p="reglaCuenta" />
                    <span className="pel-deslizador">
                      <input data-p="per" id="pel-per" type="range" min={PER_MIN} max={PER_MAX} step={1}
                        defaultValue={UMBRALES.per} aria-label={t("landing_per_maximo")} />
                    </span>
                  </li>
                </ol>
                <span className="pel-pista" data-p="pista">{t("landing_pista_per")}</span>
              </div>
              <div data-it="pesos" className="pel-it">
                <span className="pel-ceja">{t("landing_pesos_ceja")}</span>
                <ol className="pel-pesos">
                  {pesos.map((p) => (
                    <li key={p.nombre} data-p="peso" data-peso={p.peso}><span className="pt">{p.nombre}</span>
                      <span className="pb"><i /></span><span className="pv">{t("landing_peso_tramo", { valor: p.peso })}</span></li>
                  ))}
                </ol>
              </div>
              <div data-it="cartera" className="pel-it">
                <span className="pel-ceja">{t("landing_nombre_estrategia")}</span>
                <p className="pel-frase">{t("landing_cartera_frase")}<small>{t("landing_cartera_sub")}</small></p>
              </div>
              <div data-it="nota" className="pel-it">
                <span className="pel-ceja">{t("landing_nota_ceja")}</span>
                <p className="pel-frase" data-p="notaCap" />
                <p className="pel-lectura"><span data-p="lectJ" /> · <b data-p="lectTu" /> · <span data-p="lectSp" /></p>
              </div>
              <div data-it="veredicto" className="pel-it pel-veredicto">
                <span className="pel-ceja">{t("landing_veredicto_ceja")}</span>
                <b data-p="verFrase" />
                <span className="pel-sub" data-p="verSub" />
              </div>
              <div data-it="liga" className="pel-it">
                <span className="pel-ceja">{t("landing_liga_ceja")}</span>
              </div>
              <div data-it="fin" className="pel-it pel-fin">
                <h2>{t("landing_titular")}</h2>
                <p>{t("landing_fin_sub")}</p>
                <div className="pel-ctas">
                  <Link href="/entrar?next=/crear" className="pel-btn pri">{t("landing_crea_tuya")}</Link>
                  <Link href="/liga" className="pel-btn">{t("landing_ver_liga")}</Link>
                </div>
                <small>{t("landing_aviso_ejemplo")}</small>
              </div>
            </div>

            <div data-p="ficha" className="pel-ficha" hidden />
          </div>

          <nav className="pel-regleta" aria-label={t("landing_regleta_aria")}>
            {criptico && (
              <Link href={locale === "en" ? "/en/criptico" : "/criptico"} className="pel-celda pel-criptico">
                <span className="pel-ceja">{criptico.tipo === "hoy" ? t("landing_regleta_criptico_hoy")
                  : t("landing_regleta_criptico_proximo", { fecha: fechaCorta(criptico.fecha, locale) })}</span>
                {criptico.tipo === "hoy" ? (
                  <span className="pel-linea">
                    <span className="pel-pista-hoy">{criptico.pista}</span>
                    <span className="pel-casillas">
                      <span className="sr-only">{t("landing_regleta_letras", { cuantas: criptico.longitud })}</span>
                      {Array.from({ length: criptico.longitud }, (_, i) => <i key={i} className={i === 0 ? "cursor" : undefined} aria-hidden="true" />)}
                    </span>
                  </span>
                ) : (
                  <span className="pel-linea">{t("landing_regleta_avisame")}<b aria-hidden="true">›</b></span>
                )}
              </Link>
            )}
            {criptico && <span className="pel-separador" aria-hidden="true" />}
            <Link href={locale === "en" ? "/en/blog" : "/blog"} className="pel-celda pel-boletin">
              <span className="pel-ceja">{t("blog_title")}</span>
              <span className="pel-linea">{t("landing_regleta_boletin")}<b aria-hidden="true">›</b></span>
            </Link>
            <div className="pel-legal" ref={legal}>
              <button type="button" className="pel-legal-boton" aria-label={t("landing_mas")} aria-expanded={legalAbierto} aria-controls="pel-legales"
                onClick={() => setLegalAbierto((a) => !a)}><span className="pel-puntos" aria-hidden="true"><i /><i /><i /></span></button>
              <nav id="pel-legales" className={`pel-legales${legalAbierto ? " abierto" : ""}`} aria-label={t("landing_legal")}>
                <Link href="/como-funciona">{t("landing_como_funciona")}</Link>
                {PLANES_VISIBLES && (<Link href="/planes" className="pel-solo-movil">{t("landing_planes")}</Link>)}
                <Link href="/legal/aviso">{t("landing_aviso_legal")}</Link>
                <Link href="/legal/privacidad">{t("landing_privacidad")}</Link>
                <Link href="/legal/terminos">{t("landing_terminos")}</Link>
                <Link href="/legal/cookies">{t("landing_cookies")}</Link>
              </nav>
            </div>
          </nav>
        </div>
      </section>

      <section className="sr-only">
        <h2 id="pel-titulo">{t("landing_resumen_titulo")}</h2>
        <p>{t("landing_resumen")}</p>
      </section>
    </div>
  );
}
