"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { dolares, porcentajeConSigno } from "../_marco/formato";
import { Celda, Esqueleto, Grupo, Hoja, Progreso, Vacio } from "../_panel/ui";
import { LIMITES } from "./catalogo";
import { Horas, NoDisponible, Pagina } from "./Comun";
import { ALTO_IMAGEN, ANCHO_IMAGEN, descargar } from "./Compartir";
import { ICONO_COMPARTIR } from "./Flujo";
import { fecha, horaES, horasNYyES } from "./formato";
import {
  ALTO_MARCO, ANCHO_MARCO, dibujar, dibujarMarco, disposicion, duracion, eventosDe, FONDO_LIENZO,
  type Contexto, type Repeticion, type Textos,
} from "./lienzo";
import { enFrase, horaSegNY, lista, tituloDecision } from "./textos";
import type { AgenteVista, CicloActual, DecisionDetalle, Hoy, ListaDecisiones, LlamadaModelo } from "./tipos";
import { useCarga } from "./useCarga";

// Mientras piensa, cada llamada aparece al guardarse: se mira a menudo.
const REFRESCO_DIRECTO_MS = 4_000;
const VELOCIDADES = [4, 10, 1] as const;
const MAX_REGISTRO = 6;
const FPS_VIDEO = 30;

const PLAY = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z" /></svg>;
const PAUSA = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" /><rect x="13.5" y="5" width="4" height="14" rx="1.2" /></svg>;

/** Los textos del lienzo en el idioma de quien mira. */
function useTextos(): Textos {
  const t = useTranslations();
  const locale = useLocale();
  return useMemo(() => {
    const num = (v: number, dec: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
    return {
      despertar: t("pnl_agente_vivo_despertar"), loQueLleva: t("pnl_agente_vivo_lleva"), filosofia: t("pnl_agente_vivo_filosofia"),
      lecciones: t("pnl_agente_ag_lecciones_cab"), fichas: t("pnl_agente_ag_fichas_cab"), seguimiento: t("pnl_agente_vivo_seguimiento"),
      vuelta: (n, de) => t("pnl_agente_vivo_vuelta", { n, de }), pensando: seg => t("pnl_agente_vivo_pensando", { seg }),
      decide: que => t("pnl_agente_vivo_decide", { que }), esperando: n => t("pnl_agente_vivo_esperando", { n }),
      recibidas: n => t("pnl_agente_vivo_recibidas", { n }), enviada: t("pnl_agente_vivo_enviada"), despierto: t("pnl_agente_vivo_despierto"),
      cuentas: (l, c) => t("pnl_agente_vivo_cuentas", { l, c }), familia: c => t(`pnl_agente_vivo_fam_${c}`),
      pipe: {
        limites: [t("pnl_agente_cmt_limites"), t("pnl_agente_vivo_limites_fijo", { n: LIMITES.posiciones, p: LIMITES.pesoCompra })], revisor: [t("pnl_agente_cmt_revisor"), t("pnl_agente_vivo_revisor_fijo")],
        ordenes: [t("pnl_agente_cmt_ordenes"), t("pnl_agente_vivo_ordenes_fijo")], diario: [t("pnl_agente_vivo_diario"), t("pnl_agente_vivo_diario_fijo")],
      },
      repeticion: t("pnl_agente_vivo_repeticion"), directo: t("pnl_agente_vivo_directo"), decisionDe: (id, f) => t("pnl_agente_vivo_decision_de", { id, fecha: f }),
      pie: t("pnl_agente_vivo_pie"),
      textoDespierta: hora => t("pnl_agente_vivo_t_despierta", { hora }), textoPiensa: (n, de, k) => t("pnl_agente_vivo_t_piensa", { n, de, k }),
      textoDecide: (n, de, que) => t("pnl_agente_vivo_t_decide", { n, de, que }), textoLimites: n => t("pnl_agente_vivo_t_limites", { n }),
      subLimites: n => t("pnl_agente_vivo_s_limites", { n }), textoRevisor: v => t("pnl_agente_vivo_t_revisor", { v: v.toLocaleLowerCase(locale) }),
      textoOrdenes: s => t(s ? "pnl_agente_vivo_t_sombra" : "pnl_agente_vivo_t_ordenes"), subOrdenes: s => t(s ? "pnl_agente_vivo_s_sombra" : "pnl_agente_vivo_s_ordenes"),
      textoDiario: titulo => t("pnl_agente_vivo_t_diario", { titulo: enFrase(titulo, locale) }),
      sinDatos: t("pnl_agente_vivo_sin_datos"), sinFicha: t("pnl_agente_vivo_sin_ficha"), empresas: n => t("pnl_agente_vivo_empresas", { n }),
      deCon: (bien, total) => t("pnl_agente_vivo_de_con", { bien, total }), respuestas: n => t("pnl_agente_vivo_respuestas", { n }),
      caja: v => t("pnl_agente_vivo_caja", { v }), margen: v => t("pnl_agente_vivo_margen", { v }), recibido: t("pnl_agente_vivo_recibido"),
      lado: l => (t.has(`pnl_agente_lado_${l}`) ? t(`pnl_agente_lado_${l}`) : l), tipo: x => (t.has(`pnl_agente_dec_tipo_${x}`) ? t(`pnl_agente_dec_tipo_${x}`) : x),
      veredicto: v => (v ? t(`pnl_agente_ver_${v}`) : t("pnl_agente_dec_sin_revisor")),
      orden: s => (typeof s === "string" && t.has(`pnl_agente_pasos_orden_${s}`) ? t(`pnl_agente_pasos_orden_${s}`) : undefined),
      lista: (xs, max) => lista(xs, locale, t, max), dinero: (v, dec = 2) => dolares(v, locale, dec), pct: v => porcentajeConSigno(v, locale, 1),
      coste: v => dolares(v, locale, v < 0.01 ? 4 : 3), seg: m => `${num(m / 1000, 1)} s`, hora: m => horaSegNY(m, locale), horas: m => horasNYyES(new Date(m).toISOString(), locale),
      horaES: m => horaES(new Date(m).toISOString(), locale, true), fecha: ymd => fecha(ymd, locale),
    };
  }, [t, locale]);
}

interface Reproductor { i: number; t: number; jugando: boolean; vel: number; ultimo: number }

function Lienzo({ rep, directo, ctx, titulo, sub }: { rep: Repeticion; directo: boolean; ctx: Contexto; titulo: string; sub: string }) {
  const t = useTranslations();
  const T = useTextos();
  const cv = useRef<HTMLCanvasElement>(null);
  const quieto = useRef(false);
  const rp = useRef<Reproductor>({ i: directo ? Math.max(0, rep.eventos.length - 1) : 0, t: 0, jugando: true, vel: 4, ultimo: 0 });
  const repRef = useRef(rep);
  const [paso, setPaso] = useState({ i: rp.current.i, jugando: true, vel: 4, avance: 0 });
  const [compartir, setCompartir] = useState<{ url: string } | null>(null);
  const [video, setVideo] = useState<"" | "grabando" | "hecho" | "fallo">("");
  const [pct, setPct] = useState(0);

  useEffect(() => { repRef.current = rep; }, [rep]);
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    quieto.current = m.matches;
    if (m.matches) { rp.current.jugando = false; setPaso(p => ({ ...p, jugando: false })); }
    document.body.classList.add("modo-lienzo");
    return () => document.body.classList.remove("modo-lienzo");
  }, []);

  // Un solo bucle de dibujo; React solo se entera cuando cambia el paso.
  useEffect(() => {
    let id = 0;
    const cuadro = (ahora: number) => {
      const r = rp.current, ev = repRef.current.eventos, canvas = cv.current;
      const dt = Math.min(.1, (ahora - (r.ultimo || ahora)) / 1000); r.ultimo = ahora;
      if (r.jugando && ev.length) {
        const e = ev[Math.min(r.i, ev.length - 1)];
        r.t += dt / duracion(e, r.vel);
        if (r.t >= 1) {
          if (r.i < ev.length - 1) { r.i++; r.t = 0; }
          else { r.t = 1; if (!directo) r.jugando = false; }
        }
        setPaso(p => (p.i === r.i && p.jugando === r.jugando && Math.abs(p.avance - r.t) < .05 ? p : { ...p, i: r.i, jugando: r.jugando, avance: r.t }));
      }
      if (canvas && ev.length) {
        const caja = canvas.parentElement!, ancho = caja.clientWidth;
        const apaisado = innerWidth > innerHeight && innerWidth >= 560, movilApaisado = apaisado && innerHeight <= 560;
        const L = disposicion(apaisado), alto = movilApaisado ? innerHeight - 4 : ancho * L.H / L.W, dpr = devicePixelRatio || 1;
        if (canvas.width !== Math.round(ancho * dpr) || canvas.height !== Math.round(alto * dpr)) {
          canvas.width = Math.round(ancho * dpr); canvas.height = Math.round(alto * dpr); canvas.style.height = `${alto}px`;
        }
        const x = canvas.getContext("2d");
        if (x) {
          const esc = Math.min(ancho / L.W, alto / L.H);
          x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = FONDO_LIENZO; x.fillRect(0, 0, canvas.width, canvas.height);
          x.setTransform(dpr * esc, 0, 0, dpr * esc, dpr * (ancho - L.W * esc) / 2, dpr * (alto - L.H * esc) / 2);
          dibujar(x, L, repRef.current, Math.min(r.i, ev.length - 1), r.t, ahora, T, ctx, { directo, quieto: quieto.current });
        }
      }
      id = requestAnimationFrame(cuadro);
    };
    id = requestAnimationFrame(cuadro);
    return () => cancelAnimationFrame(id);
  }, [T, ctx, directo]);

  const ev = rep.eventos, i = Math.min(paso.i, ev.length - 1), e = ev[i];
  const alternar = () => {
    const r = rp.current;
    r.jugando = !r.jugando;
    if (r.jugando && r.i >= ev.length - 1 && r.t >= 1 && !directo) { r.i = 0; r.t = 0; }
    setPaso(p => ({ ...p, jugando: r.jugando, i: r.i }));
  };
  const cambiarVel = () => {
    const r = rp.current, k = VELOCIDADES.indexOf(r.vel as (typeof VELOCIDADES)[number]);
    r.vel = VELOCIDADES[(k + 1) % VELOCIDADES.length];
    setPaso(p => ({ ...p, vel: r.vel }));
  };
  const velTexto = paso.vel === 1 ? t("pnl_agente_vivo_tiempo_real") : t("pnl_agente_vivo_veces", { n: paso.vel });

  const cuadroExport = (k: number, tt: number, reloj: number, destino?: HTMLCanvasElement) => {
    const c = destino ?? document.createElement("canvas");
    c.width = ANCHO_IMAGEN; c.height = ALTO_IMAGEN;
    const x = c.getContext("2d");
    if (x) { x.setTransform(ANCHO_IMAGEN / ANCHO_MARCO, 0, 0, ALTO_IMAGEN / ALTO_MARCO, 0, 0); dibujarMarco(x, rep, k, tt, reloj, T, ctx, titulo, sub, { directo, quieto: true }); }
    return c;
  };
  const abrirCompartir = () => { setVideo(""); setCompartir({ url: cuadroExport(rp.current.i, rp.current.t, performance.now()).toDataURL("image/png") }); };
  const formato = typeof window !== "undefined" && "MediaRecorder" in window
    ? ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find(f => MediaRecorder.isTypeSupported(f)) : undefined;
  const totalVideo = ev.reduce((a, x) => a + duracion(x, paso.vel), 0) + 1.5;

  const grabar = async () => {
    if (!formato || video === "grabando") return;
    setVideo("grabando"); setPct(0);
    // Pegado al documento y fuera de la vista: algunos navegadores no emiten cuadros de un lienzo suelto.
    const lienzo = document.createElement("canvas");
    lienzo.width = ANCHO_IMAGEN; lienzo.height = ALTO_IMAGEN;
    lienzo.style.cssText = "position:fixed;left:-20000px;top:0;pointer-events:none";
    document.body.append(lienzo);
    const rec = new MediaRecorder(lienzo.captureStream(FPS_VIDEO), { mimeType: formato, videoBitsPerSecond: 6e6 });
    const trozos: Blob[] = [];
    rec.ondataavailable = d => { if (d.data.size) trozos.push(d.data); };
    const fin = new Promise(ok => { rec.onstop = ok; });
    rec.start(1000);
    let k = 0, tt = 0, pasado = 0, antes = performance.now();
    await new Promise<void>(listo => {
      const avanza = () => {
        const ahora = performance.now(), dt = (ahora - antes) / 1000; antes = ahora; pasado += dt;
        tt += dt / duracion(ev[k], paso.vel);
        if (tt >= 1) { if (k < ev.length - 1) { k++; tt = 0; } else tt = 1; }
        cuadroExport(k, Math.min(tt, 1), ahora, lienzo);
        setPct(Math.min(100, Math.round(pasado / totalVideo * 100)));
        if (pasado < totalVideo) setTimeout(avanza, 1000 / FPS_VIDEO); else listo();
      };
      avanza();
    });
    rec.stop(); await fin; lienzo.remove();
    if (!trozos.length) { setVideo("fallo"); return; }
    descargar(URL.createObjectURL(new Blob(trozos, { type: formato.split(";")[0] })), `alpha-en-vivo.${formato.includes("mp4") ? "mp4" : "webm"}`);
    setVideo("hecho");
  };

  const registro = ev.slice(0, i + 1).reverse().slice(0, MAX_REGISTRO);
  return (
    <>
      <div className="pa-lienzo"><canvas ref={cv} role="img" aria-label={t("pnl_agente_vivo_aria")} /></div>
      <p className="pa-leyenda" aria-live="polite">{e?.texto}{e?.pensamiento ? <small>«{e.pensamiento}»</small> : null}</p>
      <div className="pa-mandos">
        <button type="button" className="pa-mando" onClick={alternar} aria-label={paso.jugando ? t("pnl_agente_vivo_pausar") : t("pnl_agente_vivo_reproducir")}>{paso.jugando ? PAUSA : PLAY}</button>
        <div>
          <Progreso valor={((i + paso.avance) / Math.max(1, ev.length)) * 100} etiqueta={t("pnl_agente_vivo_avance")} />
          <small>{t("pnl_agente_vivo_paso", { n: i + 1, total: ev.length, vel: velTexto })}</small>
        </div>
        <button type="button" className="pa-mando pa-vel" onClick={cambiarVel} aria-label={velTexto}>{`${paso.vel}×`}</button>
        <button type="button" className="pa-mando" onClick={abrirCompartir} aria-label={t("pnl_agente_vivo_compartir")}>{ICONO_COMPARTIR}</button>
      </div>
      <div className="pa-registro">
        <Grupo cabecera={t("pnl_agente_dia_registro_cab")}>
          {registro.map((v, k) => (
            <Celda key={`${i}-${k}`} titulo={v.texto} subtitulo={v.resultado ? t("pnl_agente_vivo_devolvio", { r: v.resultado }) : undefined}
              valor={v.desde != null ? <Horas iso={new Date(v.desde).toISOString()} segundos /> : undefined} />
          ))}
        </Grupo>
      </div>
      <Hoja abierta={Boolean(compartir)} titulo={t("pnl_agente_compartir")} accion={t("admin_pnl_listo")} onCerrar={() => setCompartir(null)}>
        {compartir && (
          <div className="pa-hoja pa-vista">
            {/* eslint-disable-next-line @next/next/no-img-element -- imagen pintada en el navegador (data:), no hay nada que optimizar */}
            <img className="pa-imagen" src={compartir.url} alt={t("pnl_agente_vivo_aria")} width={ANCHO_IMAGEN} height={ALTO_IMAGEN} />
            <div className="pa-compartir-acc">
              <Grupo pie={formato && !formato.includes("mp4") ? t("pnl_agente_vivo_webm") : t("pnl_agente_vivo_compartir_pie")}>
                <Celda titulo={t("pnl_agente_compartir_guardar")} subtitulo={t("pnl_agente_vivo_este_instante")} tono="accion"
                  onClick={() => descargar(compartir.url, "alpha-en-vivo.png")} />
                {formato && (
                  <Celda tono="accion" onClick={grabar} deshabilitada={video === "grabando"}
                    titulo={video === "grabando" ? t("pnl_agente_vivo_grabando") : t("pnl_agente_vivo_guardar_video")}
                    subtitulo={video === "grabando" ? `${pct} %` : video === "hecho" ? t("pnl_agente_vivo_guardado") : video === "fallo" ? t("pnl_agente_vivo_video_fallo")
                      : t("pnl_agente_vivo_video_sub", { s: Math.round(totalVideo), vel: velTexto })} />
                )}
              </Grupo>
            </div>
          </div>
        )}
      </Hoja>
    </>
  );
}

/** En vivo: si el agente está pensando ahora, sus llamadas según se guardan; si no, la repetición de una
 *  decisión (la pedida o la última) con sus tiempos reales. */
export default function EnVivo({ decisionId }: { decisionId?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const T = useTextos();
  const ciclo = useCarga<CicloActual>(decisionId ? null : "/v1/ciclo/actual", REFRESCO_DIRECTO_MS);
  const ultima = useCarga<ListaDecisiones>(decisionId ? null : "/v1/decisiones?limite=1");
  const agente = useCarga<AgenteVista>("/v1/agente");
  const hoy = useCarga<Hoy>(decisionId ? null : "/v1/hoy");
  const directo = Boolean(ciclo.datos?.en_curso);
  const id = decisionId ?? (directo ? null : ciclo.datos ? String(ciclo.datos.decision_id ?? ultima.datos?.items[0]?.id ?? "") || null : null);
  const dec = useCarga<DecisionDetalle>(id ? `/v1/decisiones/${encodeURIComponent(id)}` : null);
  const ll = useCarga<{ items: LlamadaModelo[] }>(id ? `/v1/decisiones/${encodeURIComponent(id)}/llamadas` : null);

  const ctx: Contexto = useMemo(() => ({
    filosofia: agente.datos?.filosofia?.version ?? null, lecciones: agente.datos?.lecciones.length ?? 0,
    fichas: agente.datos?.fichas.length ?? 0, seguimiento: agente.datos?.seguimiento.length ?? 0,
  }), [agente.datos]);
  const rep = useMemo(() => {
    if (directo && ciclo.datos) return eventosDe(ciclo.datos.items, null, T, true);
    if (dec.datos && ll.datos && ll.datos.items.length) return eventosDe(ll.datos.items, dec.datos, T);
    return null;
  }, [directo, ciclo.datos, dec.datos, ll.datos, T]);

  const d = dec.datos;
  const tituloD = d ? tituloDecision((d.propuesta.operaciones ?? []).map(o => ({ ticker: o.ticker, lado: o.lado })), d.tipo, t, locale) : "";
  const despertar = hoy.datos?.despertares.find(x => x.tarea === "despertar");
  const meta = directo ? t("pnl_agente_vivo_meta_directo")
    : d ? (decisionId || !despertar ? t("pnl_agente_vivo_meta_dec", { titulo: enFrase(tituloD, locale), fecha: fecha(d.fecha_ny, locale) })
      : t("pnl_agente_vivo_meta", { hora: horasNYyES(despertar.hora, locale), titulo: enFrase(tituloD, locale), fecha: fecha(d.fecha_ny, locale) }))
    : "";
  const tituloImg = directo ? t("pnl_agente_vivo_img_directo") : `Alpha: ${enFrase(tituloD, locale)}`;
  const subImg = directo ? t("pnl_agente_vivo_img_directo_sub") : d ? t("pnl_agente_vivo_img_sub", { fecha: fecha(d.fecha_ny, locale) }) + (d.sombra ? ` · ${t("pnl_agente_dec_en_sombra").toLocaleLowerCase(locale)}` : "") : "";
  const fallo = [ciclo, ultima, dec, ll].find(c => c.estado === "error");
  const cargando = !rep && !fallo && (ciclo.estado === "cargando" || dec.estado === "cargando" || ll.estado === "cargando" || (!decisionId && ultima.estado === "cargando"));

  return (
    <Pagina atras={decisionId ? `/admin/alpha/decisiones/${decisionId}` : "/admin/alpha"} atrasTexto={decisionId && tituloD ? tituloD : undefined} className="pa-envivo">
      <h2 className="pa-h1">{t("pnl_agente_envivo")}</h2>
      {meta && <p className="pa-meta">{meta}</p>}
      {fallo ? <NoDisponible error={fallo.error} onReintentar={fallo.recargar} />
        : cargando ? <Esqueleto filas={6} etiqueta={t("pnl_agente_cargando")} />
        : !rep ? <Vacio titulo={t("pnl_agente_vivo_vacio")} texto={t("pnl_agente_vivo_vacio_texto")} />
        : <Lienzo key={directo ? `directo-${ciclo.datos?.ciclo}` : `dec-${id}`} rep={rep} directo={directo} ctx={ctx} titulo={tituloImg} sub={subImg} />}
    </Pagina>
  );
}
