"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { agruparPorMes, ayudaLocal, buscar, cuadriculaDelMes, resueltoLocal } from "@/lib/criptico/archivo";
import { textoDePista } from "@/lib/criptico/pista";
import type { EntradaIndice } from "@/lib/criptico/publico";
import type { Idioma, Textos } from "@/lib/criptico/tipos";
import Cabecera from "./Cabecera";
import HojaBienvenida from "./HojaBienvenida";
import Pie from "./Pie";
import Suscripcion from "./Suscripcion";
import { ruta, traductor } from "./textos";

const fecha = (idioma: Idioma, dia: string, opciones: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(idioma, { ...opciones, timeZone: "Europe/Madrid" }).format(new Date(`${dia.slice(0, 10)}T12:00:00Z`));

type Estados = Record<number, "ok" | "ayuda">;

// Todos los acertijos publicados, en el HTML del servidor para que se puedan leer y enlazar. Lo que sabe este
// dispositivo (qué has resuelto) se añade al montar; antes no se afirma nada.
export default function ArchivoPagina({ idioma, textos, indice }: { idioma: Idioma; textos: Textos; indice: EntradaIndice[] | null }) {
  const t = useMemo(() => traductor(idioma, textos), [idioma, textos]);
  const router = useRouter();
  const lista = useMemo(() => indice ?? [], [indice]);
  const ultimo = useMemo(() => lista.reduce((m, e) => Math.max(m, e.numero), 0), [lista]);
  const meses = useMemo(() => agruparPorMes(lista), [lista]);
  const numeros = useMemo(() => new Set(lista.map(e => e.numero)), [lista]);
  const porFecha = useMemo(() => new Map(lista.map(e => [e.fecha.slice(0, 10), e])), [lista]);
  const [estados, setEstados] = useState<Estados | null>(null);
  const [consulta, setConsulta] = useState("");
  const [vista, setVista] = useState<"lista" | "calendario">("lista");
  const [mesCalendario, setMesCalendario] = useState<string | null>(null);
  const [irA, setIrA] = useState("");
  const [aviso, setAviso] = useState("");
  const [ayuda, setAyuda] = useState(false);
  const empezar = useRef<HTMLButtonElement>(null);
  const cabAyuda = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const hechos: Estados = {};
    for (const e of lista) if (resueltoLocal(idioma, e.numero)) hechos[e.numero] = ayudaLocal(idioma, e.numero) ? "ayuda" : "ok";
    setEstados(hechos);
  }, [idioma, lista]);

  useEffect(() => {
    if (!ayuda) return;
    const ayudaBoton = cabAyuda.current;
    empezar.current?.focus();
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setAyuda(false); };
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("keydown", escape); ayudaBoton?.focus(); };
  }, [ayuda]);

  // El de hoy cuelga de la portada del críptico, que es su dirección; los demás, de su número.
  const hacia = (numero: number) => (numero === ultimo ? ruta(idioma) : `${ruta(idioma)}/${numero}`);
  const corta = (dia: string) => fecha(idioma, dia, { day: "numeric", month: "short" });
  const mesNombre = (clave: string) => fecha(idioma, `${clave}-01`, { month: "long", year: "numeric" });
  const etiqueta = (numero: number) => {
    if (!estados) return "";
    return t(estados[numero] === "ayuda" ? "cr_hecho_ayuda" : estados[numero] ? "cr_hecho" : "cr_pendiente");
  };

  function irAlNumero(evento: FormEvent) {
    evento.preventDefault();
    const numero = Number(irA);
    if (!Number.isInteger(numero) || !numeros.has(numero)) { setAviso(t("cr_fuera_de_rango")); return; }
    router.push(hacia(numero));
  }

  function fila(entrada: EntradaIndice) {
    return <li key={entrada.numero}>
      <Link href={hacia(entrada.numero)}>
        <span className="cr-fa-texto">
          <small>{t("cr_numero", { n: entrada.numero })} · {fecha(idioma, entrada.fecha, { weekday: "long", day: "numeric", month: "short" })}</small>
          <b>{textoDePista(entrada.pista)} ({entrada.longitud})</b>
        </span>
        <span className="cr-fa-lado"><span>{t(`cr_${entrada.nivel}`)}</span><em className={estados?.[entrada.numero] ? "hecho" : undefined}>{etiqueta(entrada.numero)}</em></span>
      </Link>
    </li>;
  }

  const resultados = buscar(lista, consulta, corta);
  const claveVisible = mesCalendario ?? meses[0]?.clave;
  const indiceMes = meses.findIndex(m => m.clave === claveVisible);
  const mes = meses[indiceMes];
  const cabeceras = [0, 1, 2, 3, 4, 5, 6].map(i => new Intl.DateTimeFormat(idioma, { weekday: "narrow", timeZone: "UTC" })
    .format(new Date(Date.UTC(2024, 0, 1 + i)))); // 1 de enero de 2024 fue lunes.
  const primera = lista.reduce<string | null>((m, e) => (m === null || e.fecha < m ? e.fecha : m), null);

  return <main className="cr-app" lang={idioma}>
    <div className="cr-scroll" inert={ayuda}>
      <Cabecera idioma={idioma} t={t} actual="archivo" alAyuda={() => setAyuda(true)} refAyuda={cabAyuda}
        enlaces={{ es: `${ruta("es")}/archivo`, en: `${ruta("en")}/archivo` }} />
      <div className="cr-cuerpo">
        <div className="cr-principal">
          <div className="cr-titulo-pagina">
            <h1 className="cr-h1">{t("cr_archivo_h1")}</h1>
            {primera && <p className="cr-meta">{t("cr_archivo_meta", { n: lista.length, fecha: fecha(idioma, primera, { day: "numeric", month: "long", year: "numeric" }) })}</p>}
          </div>
          {indice === null ? <>
            <p role="status" className="cr-nota">{t("cr_error")}</p>
            <button type="button" className="btn pri cr-reintento" onClick={() => router.refresh()}>{t("cr_reintentar")}</button>
          </> : <>
            <div className="cr-filtros">
              <input type="search" aria-label={t("cr_buscar")} placeholder={t("cr_buscar")} value={consulta}
                onChange={evento => setConsulta(evento.target.value)} />
              <form className="cr-ir" onSubmit={irAlNumero}>
                <input type="number" inputMode="numeric" min={1} max={ultimo} aria-label={t("cr_ir_a")} placeholder={t("cr_ir_a")}
                  value={irA} onChange={evento => { setIrA(evento.target.value); setAviso(""); }} />
                <button type="submit" className="btn pri">{t("cr_ir")}</button>
              </form>
              {aviso && <p role="status" className="cr-nota">{aviso}</p>}
              <div className="cr-segmentos" role="group" aria-label={t("cr_archivo_titulo")}>
                <button type="button" aria-pressed={vista === "lista"} onClick={() => setVista("lista")}>{t("cr_lista")}</button>
                <button type="button" aria-pressed={vista === "calendario"} onClick={() => setVista("calendario")}>{t("cr_calendario")}</button>
              </div>
            </div>
            {vista === "lista" && consulta.trim() && <ul className="cr-lista-archivo">
              {resultados.length ? resultados.map(fila) : <li className="cr-nota cr-sin-resultados">{t("cr_sin_coincidencias")}</li>}
            </ul>}
            {vista === "lista" && !consulta.trim() && meses.map((grupo, i) => {
              const resueltos = estados ? grupo.entradas.filter(e => estados[e.numero]).length : null;
              return <details key={grupo.clave} className="cr-mes" open={i === 0}>
                <summary className="cr-mes-cab">
                  <b>{mesNombre(grupo.clave)}</b>
                  <small>{resueltos === null ? "" : t("cr_resueltos", { n: resueltos, total: grupo.entradas.length })}</small>
                </summary>
                <ul className="cr-lista-archivo">{grupo.entradas.map(fila)}</ul>
              </details>;
            })}
            {vista === "calendario" && mes && <section className="cr-mes">
              <div className="cr-mes-nav">
                <button type="button" className="cr-enlace" aria-label={t("cr_mes_anterior")} disabled={indiceMes >= meses.length - 1}
                  onClick={() => setMesCalendario(meses[indiceMes + 1].clave)}>‹</button>
                <b>{mesNombre(mes.clave)}</b>
                <button type="button" className="cr-enlace" aria-label={t("cr_mes_siguiente")} disabled={indiceMes <= 0}
                  onClick={() => setMesCalendario(meses[indiceMes - 1].clave)}>›</button>
              </div>
              <div className="cr-cuadricula">
                {cabeceras.map((letra, i) => <span key={i} className="cr-cab-dia" aria-hidden="true">{letra}</span>)}
                {cuadriculaDelMes(mes.clave).map((celda, i) => {
                  if (!celda) return <span key={i} className="cr-celda vacia" aria-hidden="true" />;
                  const entrada = porFecha.get(celda.fecha);
                  if (!entrada) return <span key={i} className="cr-celda sin">{celda.dia}</span>;
                  return <Link key={i} href={hacia(entrada.numero)} aria-label={t("cr_numero", { n: entrada.numero })}
                    className={`cr-celda${estados?.[entrada.numero] ? " hecho" : ""}${entrada.numero === ultimo ? " hoy" : ""}`}>{celda.dia}</Link>;
                })}
              </div>
            </section>}
          </>}
        </div>
        <aside className="cr-lateral"><Suscripcion idioma={idioma} t={t} /></aside>
      </div>
      <Pie idioma={idioma} t={t} />
    </div>
    {ayuda && <HojaBienvenida t={t} cerrar={() => setAyuda(false)} empezar={empezar} />}
  </main>;
}
