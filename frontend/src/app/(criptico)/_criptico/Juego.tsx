"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import * as api from "@/lib/criptico/api";
import { SelectorIdioma } from "@/components/SelectorIdioma";
import { normalizar } from "@/lib/criptico/letras";
import { bienvenidaVista, borrar, cargarPartida, escribir, guardarBienvenida, guardarPartida, nuevaPartida } from "@/lib/criptico/partida";
import type { Partida } from "@/lib/criptico/partida";
import { reloj, segundosHastaMedianoche } from "@/lib/criptico/reloj";
import type { Acertijo, Ayuda, Detalle, Textos } from "@/lib/criptico/tipos";
import { Marca } from "../../(liga)/_ui/Marca";
import { Leyenda, Pista } from "./Pista";
import Ayudas from "./Ayudas";
import Teclado from "./Teclado";
import Resultado from "./Resultado";
import Gancho from "./Gancho";
import Archivo, { HojaArchivo, useIndice } from "./Archivo";
import { useHojaAtras } from "./hoja-atras";
import Suscripcion from "./Suscripcion";
import { ruta, traductor } from "./textos";

export const MOVIL_QUERY = "(max-width: 767px), (pointer: coarse)";

export default function Juego({ acertijo: a, textos, ultimoNumero = a.numero }: {
  acertijo: Acertijo; textos: Textos; ultimoNumero?: number;
}) {
  const t = useMemo(() => traductor(a.idioma, textos), [a.idioma, textos]);
  const [partida, setPartida] = useState<Partida>(() => nuevaPartida(a.longitud));
  const actual = useRef(partida);
  const [listo, setListo] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [mensaje, setMensaje] = useState("");
  const [temblor, setTemblor] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const bloqueo = useRef(false);
  const [bienvenida, setBienvenida] = useState(false);
  const [archivo, setArchivo] = useState(false);
  const [teclado, setTeclado] = useState(false);
  const { indice, error: errorIndice } = useIndice(a.idioma);
  const [cuenta, setCuenta] = useState("");
  const empezar = useRef<HTMLButtonElement>(null);
  const cabAyuda = useRef<HTMLButtonElement>(null);

  const actualizar = useCallback((p: Partida) => {
    actual.current = p; setPartida(p); guardarPartida(a, p);
  }, [a]);

  useEffect(() => {
    const p = cargarPartida(a);
    actual.current = p; setPartida(p);
    const inicio = p.letras.findIndex((l, i) => !l && !(i === 0 && p.ayudas.includes("letra")));
    setCursor(inicio < 0 ? p.letras.length - 1 : inicio);
    setListo(true);
    if (window.matchMedia(MOVIL_QUERY).matches && !bienvenidaVista()) setBienvenida(true);
  }, [a]);

  useEffect(() => {
    const tick = () => setCuenta(reloj(segundosHastaMedianoche()));
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!bienvenida) return;
    const previo = document.activeElement;
    const ayuda = cabAyuda.current;
    empezar.current?.focus();
    return () => { if (previo instanceof HTMLElement && previo !== document.body) previo.focus(); else ayuda?.focus(); };
  }, [bienvenida]);

  const cerrarBienvenida = useCallback(() => { guardarBienvenida(); setBienvenida(false); }, []);
  useHojaAtras(bienvenida, cerrarBienvenida);
  const editar = useCallback((letra: string) => {
    if (!listo || bloqueo.current || bienvenida) return;
    const p = actual.current;
    const i = cursor === 0 && p.ayudas.includes("letra") ? 1 : cursor;
    const siguiente = escribir(p, i, letra, a.idioma);
    if (siguiente === p) return;
    actualizar(siguiente); setCursor(Math.min(i + 1, a.longitud - 1)); setMensaje("");
  }, [listo, bienvenida, cursor, a.idioma, a.longitud, actualizar]);

  const retroceso = useCallback(() => {
    if (!listo || bloqueo.current || bienvenida) return;
    const siguiente = borrar(actual.current, cursor);
    actualizar(siguiente.partida); setCursor(siguiente.indice); setMensaje("");
  }, [listo, bienvenida, cursor, actualizar]);

  const terminar = useCallback((detalle: Detalle, resultado: "resuelto" | "solucion") => {
    const p = actual.current;
    actualizar({ ...p, detalle, resultado, letras: [...normalizar(detalle.respuesta)], registrado: true });
    setMensaje("");
  }, [actualizar]);

  const comprobar = useCallback(async () => {
    const p = actual.current;
    if (!listo || bloqueo.current || bienvenida || p.resultado !== "jugando") return;
    if (p.letras.some(l => !l)) { setMensaje(t("cr_faltan")); return; }
    bloqueo.current = true; setOcupado(true); setMensaje("");
    try {
      const respuesta = await api.comprobar(a.id, p.letras.join(""));
      if (respuesta.correcta && respuesta.detalle) {
        terminar(respuesta.detalle, "resuelto");
        if (!p.registrado) await api.resuelto(a.id, p.ayudas.length);
      } else { setMensaje(t("cr_todavia")); setTemblor(n => n + 1); }
    } catch { setMensaje(t("cr_error")); }
    finally { bloqueo.current = false; setOcupado(false); }
  }, [a.id, bienvenida, listo, t, terminar]);

  async function pedir(tipo: Ayuda) {
    const p = actual.current;
    if (!listo || bloqueo.current || bienvenida || p.resultado !== "jugando" || p.ayudas.includes(tipo)) return;
    bloqueo.current = true; setOcupado(true); setMensaje("");
    try {
      const letras = [...p.letras];
      if (tipo === "letra") letras[0] = normalizar((await api.letra(a.id)).letra);
      actualizar({ ...p, letras, ayudas: [...p.ayudas, tipo] });
      if (tipo === "letra") setCursor(Math.min(1, a.longitud - 1));
    } catch { setMensaje(t("cr_error")); }
    finally { bloqueo.current = false; setOcupado(false); }
  }

  async function verSolucion() {
    const p = actual.current;
    if (!listo || bloqueo.current || bienvenida || p.resultado !== "jugando") return;
    bloqueo.current = true; setOcupado(true); setMensaje("");
    try { terminar((await api.solucion(a.id, p.ayudas.length)).detalle, "solucion"); }
    catch { setMensaje(t("cr_error")); }
    finally { bloqueo.current = false; setOcupado(false); }
  }

  useEffect(() => {
    function pulsar(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (archivo) { if (e.key === "Escape") setArchivo(false); return; }
      if (bienvenida) {
        if (e.key === "Tab") { e.preventDefault(); empezar.current?.focus(); }
        if (e.key === "Escape") cerrarBienvenida();
        return;
      }
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "Enter") {
        if (target?.closest("a, button:not([data-casilla])")) return;
        e.preventDefault(); void comprobar();
      } else if (e.key === "Backspace") { e.preventDefault(); retroceso(); }
      else if (e.key.length === 1) editar(e.key);
    }
    document.addEventListener("keydown", pulsar);
    return () => document.removeEventListener("keydown", pulsar);
  }, [archivo, bienvenida, cerrarBienvenida, comprobar, editar, retroceso]);

  const terminado = partida.resultado !== "jugando";
  return <main className={`cr-app${terminado ? " cr-terminado" : ""}${teclado && !terminado ? " cr-con-teclado" : ""}`} lang={a.idioma}>
    <div className="cr-scroll" inert={bienvenida || archivo}>
      <header className="cr-cab">
        <Link className="sello" href={ruta(a.idioma)}><Marca className="marca" /><i aria-hidden="true" /><b>{t("cr_nombre")}</b></Link>
        <nav><SelectorIdioma actual={a.idioma} etiqueta={t("cr_idioma_selector")} enlaces={{
          es: `${ruta("es")}${a.numero === ultimoNumero ? "" : `/${a.numero}`}`,
          en: `${ruta("en")}${a.numero === ultimoNumero ? "" : `/${a.numero}`}`,
        }} />
          <button type="button" className="cr-icono" onClick={() => setArchivo(true)} aria-label={t("cr_archivo_titulo")}>▤</button>
          <button type="button" ref={cabAyuda} className="cr-icono" onClick={() => setBienvenida(true)} aria-label={t("cr_leer")}>?</button>
        </nav>
      </header>
      <h1 className="cr-sr">{t("cr_titulo")}</h1>
      <div className="cr-cuerpo">
        <div className="cr-principal">
          <Archivo idioma={a.idioma} actual={a.numero} ultimo={ultimoNumero} fecha={a.fecha} indice={indice} t={t} />
          <div className="cr-encabezado"><p className="cr-meta">{t("cr_numero", { n: a.numero })}</p><span className="cr-nivel">{t(`cr_${a.nivel}`)}</span></div>
          <p className="cr-pista"><Pista segmentos={a.pista} ayudas={partida.ayudas} completa={terminado} /> <span className="cr-enum">({a.longitud})</span></p>
          <div key={temblor} className={`cr-casillas${temblor ? " cr-mal" : ""}`} style={{ "--casillas": a.longitud } as CSSProperties}>
            {partida.letras.map((l, i) => <button type="button" key={i} data-casilla
              className={`cr-casilla${terminado ? " bien" : partida.ayudas.includes("letra") && i === 0 ? " fija" : i === cursor ? " activa" : ""}`}
              disabled={!listo || terminado || ocupado || (i === 0 && partida.ayudas.includes("letra"))}
              onClick={() => { setCursor(i); setTeclado(true); }} aria-label={t("cr_casilla", { n: i + 1, total: a.longitud,
                fija: i === 0 && partida.ayudas.includes("letra") ? t("cr_fija") : "" })}>{l}</button>)}
          </div>
          <p role="status" className="cr-mensaje">{mensaje}</p>
          {terminado && partida.detalle ? <Resultado acertijo={a} partida={partida} detalle={partida.detalle} t={t} /> : <>
            <div className="cr-acciones-esc"><button type="button" className="btn pri" disabled={!listo || ocupado} onClick={() => void comprobar()}>{t("cr_comprobar")}</button><p>{t("cr_fisico")}</p></div>
            <Ayudas acertijo={a} usadas={partida.ayudas} pedir={tipo => void pedir(tipo)} verSolucion={() => void verSolucion()} ocupado={!listo || ocupado} t={t} />
          </>}
        </div>
        <aside className="cr-lateral">
          <Suscripcion idioma={a.idioma} t={t} />
          {terminado && partida.detalle && <Gancho detalle={partida.detalle} t={t} />}
          <p className="cr-proximo">{t("cr_proximo")} <span className="cr-cuenta">{cuenta}</span></p>
        </aside>
      </div>
      <footer className="cr-aviso">{t("cr_aviso")}</footer>
    </div>
    {!terminado && teclado && <div inert={bienvenida || archivo}><Teclado idioma={a.idioma} escribir={editar} borrar={retroceso} comprobar={() => void comprobar()} ocultar={() => setTeclado(false)} ocupado={!listo || ocupado} t={t} /></div>}
    {bienvenida && <div className="cr-bienvenida" onClick={evento => { if (evento.target === evento.currentTarget) cerrarBienvenida(); }}><section className="cr-hoja" role="dialog" aria-modal="true" aria-labelledby="cr-bienvenida-titulo">
      <div className="cr-grabber" aria-hidden="true" />
      <h2 id="cr-bienvenida-titulo">{t("cr_bienvenida")}</h2>
      <ol><li>{t("cr_paso_uno")}</li><li>{t("cr_paso_dos")}</li><li>{t("cr_paso_tres")}</li></ol>
      <Leyenda t={t} /><button ref={empezar} type="button" className="btn pri wide" onClick={cerrarBienvenida}>{t("cr_empezar")}</button>
    </section></div>}
    {archivo && <HojaArchivo idioma={a.idioma} actual={a.numero} ultimo={ultimoNumero} fecha={a.fecha} indice={indice} error={errorIndice}
      cerrar={() => setArchivo(false)} t={t} />}
  </main>;
}
