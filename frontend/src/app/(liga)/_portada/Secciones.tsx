"use client";

// Lo que hay debajo de la demo (maqueta v15): la idea por dentro, la semana de las tres de Vennett,
// el crucigrama de hoy, el último artículo y el pie.

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "@/components/Enlace";
import { useTranslations } from "next-intl";
import type { EstadoCriptico } from "@/lib/criptico/estado";
import * as api from "@/lib/criptico/api";
import { cargarPartida, guardarPartida } from "@/lib/criptico/partida";
import { normalizar, validarLetra } from "@/lib/criptico/letras";
import { ORDEN_ESTILOS, idRegla, type PortadaDemo, type SemanaDemo } from "@/lib/liga/portada";
import { Escudo, escudoCasa } from "../_ui/Escudo";
import { CASA } from "../_ui/casa";
import { Marca } from "../_ui/Marca";
import { tamanoDe } from "./Demo";
import { conSigno, decimal, diaMes, miles, porcentaje, porcentajeSinSigno, tramo, type Idioma } from "./formato";

export type BoletinPortada = { slug: string; titulo: string; resumen: string; minutos: number } | null;

function Chevron() {
  return <svg className="chev" viewBox="0 0 8 13" aria-hidden="true"><path d="M1 1l5.5 5.5L1 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function PorDentro({ datos, k, idioma }: { datos: PortadaDemo; k: number; idioma: Idioma }) {
  const t = useTranslations();
  const clave = ORDEN_ESTILOS[k], estilo = datos.estilos[clave], nombre = t(`portada_estilo_${clave}_nombre`);
  return <section className="dentro seccion" aria-labelledby="dentro-t">
    <h2 className="tit" id="dentro-t">{t.rich("portada_dentro_titulo", { estilo: nombre, q: (c) => <q>{c}</q> })}</h2>
    <p className="bajada">{t("portada_dentro_bajada", { pasan: miles(estilo.pasan, idioma), total: miles(datos.total, idioma) })}</p>
    <div className="doble">
      <div>
        <p className="sub-tit"><span>{t("portada_cinco_tit")}</span><span>{t("portada_cinco_nota")}</span></p>
        <ol className="grupo sangria cinco">
          {estilo.cinco.map((c, m) => <li key={c.ticker}>
            <span className="pos">{m + 1}</span>
            <span className="centro"><span className="nom">{c.nombre}</span>
              <span className="sub">{t("portada_cinco_sub", { ticker: c.ticker, tamano: t(`portada_tamano_${tamanoDe(c.rango, datos)}`) })}</span></span>
            <span className="nota">{decimal(c.nota, idioma)}<small>{t("portada_de_cien")}</small></span>
          </li>)}
        </ol>
      </div>
      <div>
        <p className="sub-tit"><span>{t("portada_reglas_tit")}</span><span>{t("portada_reglas_todas")}</span></p>
        <ul className="grupo reglas">
          {estilo.reglas.map((r) => {
            const id = idRegla(r), propia = id !== null && t.has(`portada_regla_${id}_t`);
            return <li key={`${r.clave}-${id}`}><div>
              <p className="t">{propia ? t(`portada_regla_${id}_t`) : r.detalle}</p>
              {propia && <p className="s">{t(`portada_regla_${id}_s`)}</p>}
            </div></li>;
          })}
        </ul>
      </div>
    </div>
    {datos.notas_del && <p className="pie-grupo">{t("portada_dentro_pie", { fecha: diaMes(datos.notas_del, idioma) })}</p>}
  </section>;
}

type Modo = "vs" | "rent" | "pts";
const SIGUIENTE: Record<Modo, Modo> = { vs: "rent", rent: "pts", pts: "vs" };
const BOTON: Record<Modo, string> = { vs: "portada_ver_rent", rent: "portada_ver_pts", pts: "portada_ver_vs" };

export function Semana({ semana, idioma, alAbrir }: { semana: SemanaDemo; idioma: Idioma; alAbrir: (h: "casa" | "idea") => void }) {
  const t = useTranslations();
  const [modo, setModo] = useState<Modo>("vs");
  const [visible, setVisible] = useState(false);
  const lista = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = lista.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) { setVisible(true); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const ganan = semana.casa.filter((c) => (c.dif_sp ?? 0) > 0).length;
  const todasDebajo = semana.casa.every((c) => (c.dif_sp ?? 0) < 0);
  const maximo = Math.max(...semana.casa.map((c) => Math.abs(c.dif_sp ?? 0)), 0.0001);
  const fechas = tramo(semana.dia_inicio, semana.dia_fin, idioma);
  const num = (c: ReactNode) => <span className="num">{c}</span>;
  const pildora = (c: SemanaDemo["casa"][number]) => modo === "rent" ? (c.rentabilidad === null ? "–" : porcentaje(c.rentabilidad, idioma))
    : modo === "pts" ? t("portada_semana_pts", { n: c.puntos ?? 0 }) : c.dif_sp === null ? "–" : conSigno(c.dif_sp, idioma);

  return <section className="seccion semana" aria-labelledby="semana-t">
    <h2 className="tit" id="semana-t">{t("portada_semana_titulo", { n: ganan })}</h2>
    <p className="bajada">
      {semana.sp !== null && <>{t.rich(semana.sp < 0 ? "portada_semana_bajada_cae" : "portada_semana_bajada_sube", { sp: porcentajeSinSigno(semana.sp, idioma), desde: fechas.desde, hasta: fechas.hasta, num })}{" "}</>}
      {t(todasDebajo ? "portada_semana_pildora_debajo" : "portada_semana_pildora")}
    </p>
    <ul className="grupo sangria" ref={lista}>
      {semana.casa.map((c) => {
        const nombre = CASA[c.casa].nombre, gana = (c.dif_sp ?? 0) > 0;
        return <li key={c.casa}><button type="button" className="fila" onClick={() => alAbrir("casa")}>
          <Escudo valor={escudoCasa(c.casa)} casa={c.casa} etiqueta={t("portada_escudo_casa", { nombre })} tamano={34} />
          <span className="centro"><span className="nom">{nombre}</span>
            <span className="sub">{t.rich("portada_semana_rent", { rent: c.rentabilidad === null ? "–" : porcentaje(c.rentabilidad, idioma), num })}</span>
            <span className="distancia"><i className={gana ? "bien" : undefined}
              style={{ transform: `scaleX(${visible ? (Math.abs(c.dif_sp ?? 0) / maximo).toFixed(3) : 0})` }} /></span></span>
          <span className={`pildora${gana ? " bien" : ""}`}>{pildora(c)}</span>
        </button></li>;
      })}
      <li><div className="fila tuya">
        <span className="hueco" aria-hidden="true" />
        <span className="centro"><span className="nom">{t("portada_tu_idea")}</span><span className="sub">{t("portada_tu_idea_sub")}</span></span>
        <button type="button" className="ir" onClick={() => alAbrir("idea")}>{t("portada_escribir")}</button>
      </div></li>
    </ul>
    <p className="pie-grupo">{t("portada_semana_pie")}{" "}
      <button type="button" className="cambiar" onClick={() => setModo(SIGUIENTE[modo])}>{t(BOTON[modo])}</button></p>
  </section>;
}

type Estado = { tipo: "nada" } | { tipo: "ok"; texto: string } | { tipo: "mal" } | { tipo: "error" };

export function Crucigrama({ criptico, idioma }: { criptico: Exclude<EstadoCriptico, null>; idioma: Idioma }) {
  const t = useTranslations();
  const prefijo = idioma === "en" ? "/en" : "";
  const [resp, setResp] = useState("");
  const [foco, setFoco] = useState(false);
  const [estado, setEstado] = useState<Estado>({ tipo: "nada" });
  const [ocupado, setOcupado] = useState(false);
  const hoy = criptico.tipo === "hoy" ? criptico : null;

  // Si ya lo resolvió aquí o en el crucigrama, se ve resuelto: es la misma partida.
  useEffect(() => {
    if (!hoy) return;
    const p = cargarPartida({ idioma, numero: hoy.numero, longitud: hoy.longitud });
    if (p.resultado !== "jugando" && p.detalle) {
      setResp(p.letras.join(""));
      setEstado({ tipo: "ok", texto: p.detalle.resolucion });
    }
  }, [hoy, idioma]);

  if (!hoy) {
    const fecha = criptico.tipo === "proximo" ? diaMes(criptico.fecha, idioma) : "";
    return <section className="seccion" aria-labelledby="cruci-t">
      <h2 className="tit" id="cruci-t">{t("portada_cruci_titulo")}</h2>
      <p className="bajada">{t("portada_cruci_proximo", { fecha })}</p>
      <ul className="grupo"><li><Link className="enlace" href={`${prefijo}/criptico`}>{t("portada_ir_crucigrama")}<Chevron /></Link></li></ul>
    </section>;
  }

  const resuelto = estado.tipo === "ok";
  const comprobar = async () => {
    if (resp.length < hoy.longitud || ocupado || resuelto) return;
    setOcupado(true);
    try {
      const r = await api.comprobar(hoy.id, resp);
      if (!r.correcta) { setEstado({ tipo: "mal" }); return; }
      setEstado({ tipo: "ok", texto: r.detalle?.resolucion ?? "" });
      if (r.detalle) guardarPartida({ idioma, numero: hoy.numero }, { letras: resp.split(""), ayudas: [], resultado: "resuelto", detalle: r.detalle, registrado: true });
      void api.resuelto(hoy.id, 0).catch(() => {});
    } catch {
      setEstado({ tipo: "error" });
    } finally {
      setOcupado(false);
    }
  };
  const mensaje = estado.tipo === "ok" ? (estado.texto ? t("portada_cruci_bien", { resolucion: estado.texto }) : t("portada_cruci_bien_corto"))
    : estado.tipo === "mal" ? t("portada_cruci_mal", { n: hoy.longitud }) : estado.tipo === "error" ? t("portada_cruci_error") : "";

  return <section className="seccion" aria-labelledby="cruci-t">
    <h2 className="tit" id="cruci-t">{t("portada_cruci_titulo")}</h2>
    <p className="bajada">{t("portada_cruci_bajada", { numero: hoy.numero, nivel: t(`hoy_nivel_${hoy.nivel}`).toLowerCase() })}</p>
    <ul className="grupo">
      <li className="cruci">
        <p className="pista">{hoy.pista} ({hoy.longitud})</p>
        <div className="resolver">
          <label className={`casillas${resuelto ? " ok" : estado.tipo === "mal" ? " mal" : ""}`}>
            {Array.from({ length: hoy.longitud }, (_, i) => <span key={i}
              className={foco && !resuelto && i === Math.min(resp.length, hoy.longitud - 1) ? "activa" : undefined}>{resp[i] ?? ""}</span>)}
            <input value={resp} maxLength={hoy.longitud} autoComplete="off" autoCapitalize="characters" spellCheck={false}
              readOnly={resuelto} aria-label={t("portada_cruci_respuesta", { n: hoy.longitud })}
              onFocus={() => setFoco(true)} onBlur={() => setFoco(false)}
              onKeyDown={(e) => { if (e.key === "Enter") void comprobar(); }}
              onChange={(e) => {
                const letras = [...e.target.value].filter((l) => validarLetra(l, idioma)).map(normalizar).join("").slice(0, hoy.longitud);
                setResp(letras); setEstado({ tipo: "nada" });
              }} />
          </label>
          <button type="button" className="comprobar" disabled={resp.length < hoy.longitud || ocupado || resuelto} onClick={() => void comprobar()}>{t("portada_comprobar")}</button>
        </div>
        <p className="estado" role="status">{mensaje}</p>
      </li>
      <li><Link className="enlace" href={`${prefijo}/criptico`}>{t("portada_mas_crucigramas")}<Chevron /></Link></li>
    </ul>
  </section>;
}

export function Boletin({ boletin, idioma }: { boletin: NonNullable<BoletinPortada>; idioma: Idioma }) {
  const t = useTranslations();
  const ruta = `${idioma === "en" ? "/en" : ""}/blog/${boletin.slug}`;
  return <section className="seccion bol" aria-labelledby="bol-t">
    <h2 className="tit" id="bol-t">{t("portada_boletin")}</h2>
    <p className="bajada">{t("portada_boletin_bajada")}</p>
    <div className="grupo">
      <Link className="articulo" href={ruta}>
        {/* eslint-disable-next-line @next/next/no-img-element -- la tarjeta del artículo ya sale optimizada de su ruta */}
        <img src={`${ruta}/imagen`} alt="" width={1200} height={630} loading="lazy" decoding="async" />
        <span className="texto">
          <span className="titular-b">{boletin.titulo}</span>
          <span className="resumen">{boletin.resumen}</span>
          <span className="meta">{t("portada_lectura", { n: boletin.minutos })}</span>
        </span>
      </Link>
    </div>
  </section>;
}

export function Pie({ idioma }: { idioma: Idioma }) {
  const t = useTranslations();
  return <footer className="pie">
    <div className="dentro pie-rejilla">
      <div className="pie-col pie-marca"><Marca className="nombre" /><p>{t("portada_pie_lema")}</p></div>
      <div className="pie-col pie-letra"><p className="pie-tit">{t("portada_pie_letra")}</p>
        <ul>{[1, 2, 3, 4].map((i) => <li key={i}>{t(`portada_pie_letra_${i}`)}</li>)}</ul></div>
      <nav className="pie-col" aria-label={t("portada_pie_vennett")}><p className="pie-tit">{t("portada_pie_vennett")}</p><ul>
        <li><Link href="/como-funciona">{t("landing_como_funciona")}</Link></li>
        <li><Link href="/quienes-somos">{t("landing_quienes")}</Link></li>
        <li><Link href="/politica-editorial">{t("landing_politica_editorial")}</Link></li>
        <li><Link href={`${idioma === "en" ? "/en" : ""}/blog`}>{t("portada_pie_boletin")}</Link></li>
      </ul></nav>
      <nav className="pie-col" aria-label={t("landing_legal")}><p className="pie-tit">{t("landing_legal")}</p><ul>
        <li><Link href="/legal/aviso">{t("landing_aviso_legal")}</Link></li>
        <li><Link href="/legal/privacidad">{t("landing_privacidad")}</Link></li>
        <li><Link href="/legal/cookies">{t("landing_cookies")}</Link></li>
      </ul></nav>
    </div>
    <div className="dentro"><p className="pie-legal">{t("portada_pie_aviso")}</p></div>
  </footer>;
}
