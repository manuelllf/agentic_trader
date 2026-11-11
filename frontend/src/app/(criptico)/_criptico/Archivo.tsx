import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import * as api from "@/lib/criptico/api";
import { agruparPorMes, ayudaLocal, buscar, cuadriculaDelMes, fechaDeNumero, resueltoLocal } from "@/lib/criptico/archivo";
import type { EntradaIndice } from "@/lib/criptico/publico";
import type { Idioma, Traducir } from "@/lib/criptico/tipos";
import { ruta } from "./textos";
import { soltarHoja, useHojaAtras } from "./hoja-atras";
import { Esqueleto } from "./Esqueleto";

type Indice = EntradaIndice[] | null;

const fechaCorta = (idioma: Idioma, fecha: string, opciones: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(idioma, { ...opciones, timeZone: "Europe/Madrid" }).format(new Date(`${fecha.slice(0, 10)}T12:00:00Z`));
const rutaNumero = (idioma: Idioma, numero: number) => `${ruta(idioma)}/${numero}`;

// Una petición por idioma: volver a montar la página no la repite.
const indicePorIdioma = new Map<Idioma, EntradaIndice[]>();

export function useIndice(idioma: Idioma): { indice: Indice; error: boolean } {
  const [indice, setIndice] = useState<Indice>(indicePorIdioma.get(idioma) ?? null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const guardado = indicePorIdioma.get(idioma);
    if (guardado) { setIndice(guardado); return; }
    let activo = true;
    api.indice(idioma).then(datos => {
      indicePorIdioma.set(idioma, datos);
      if (activo) setIndice(datos);
    }, () => { if (activo) setError(true); });
    return () => { activo = false; };
  }, [idioma]);
  return { indice, error };
}

// Cinco días seguidos con el que estás viendo en medio, o al final si es de los últimos: siempre se ve dónde estás.
// Se calcula al instante, sin esperar al índice, para que no salte al cargar.
export default function Archivo({ idioma, actual, ultimo, fecha, indice, t }: {
  idioma: Idioma; actual: number; ultimo: number; fecha: string; indice: Indice; t: Traducir;
}) {
  const inicio = Math.max(1, Math.min(actual - 2, ultimo - 4));
  const numeros = Array.from({ length: Math.min(5, ultimo) }, (_, i) => inicio + i);
  return <nav className="cr-dias" aria-label={t("cr_archivo")}>
    {numeros.map(numero => {
      const entrada = indice?.find(e => e.numero === numero);
      const dia = entrada?.fecha ?? fechaDeNumero(fecha, actual, numero);
      const hecho = resueltoLocal(idioma, numero);
      return <Link key={numero} href={rutaNumero(idioma, numero)}
        aria-current={actual === numero ? "page" : undefined} className={`cr-dia${hecho ? " hecho" : ""}`}
        aria-label={`${fechaCorta(idioma, dia, { dateStyle: "long" })}: ${t(hecho ? "cr_hecho" : "cr_pendiente")}`}>
        <span>{numero === ultimo ? t("cr_hoy") : fechaCorta(idioma, dia, { weekday: "short" })}</span>
        <b>{fechaCorta(idioma, dia, { day: "numeric" })}</b><i aria-hidden="true" />
      </Link>;
    })}
  </nav>;
}

// Hoja con todo el archivo: búsqueda, «Ir a un número», meses plegables y calendario del mes.
export function HojaArchivo({ idioma, actual, ultimo, fecha, indice, error, cerrar, t }: {
  idioma: Idioma; actual: number; ultimo: number; fecha: string; indice: Indice; error: boolean; cerrar: () => void; t: Traducir;
}) {
  const router = useRouter();
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const [vista, setVista] = useState<"lista" | "calendario">("lista");
  const [consulta, setConsulta] = useState("");
  const [irA, setIrA] = useState("");
  const [aviso, setAviso] = useState("");
  const [pliegues, setPliegues] = useState<Record<string, boolean>>({});
  const [mesCalendario, setMesCalendario] = useState<string | null>(null);
  const lista = useMemo(() => indice ?? [], [indice]);
  const meses = useMemo(() => agruparPorMes(lista), [lista]);
  const numeros = useMemo(() => new Set(lista.map(entrada => entrada.numero)), [lista]);
  const porFecha = useMemo(() => new Map(lista.map(entrada => [entrada.fecha.slice(0, 10), entrada])), [lista]);
  const corta = (dia: string) => fechaCorta(idioma, dia, { day: "numeric", month: "short" });
  // El mes del acertijo que estás viendo, abierto por defecto: así sabes dónde estás.
  const mesActual = fecha.slice(0, 7);
  const expandido = (clave: string) => pliegues[clave] ?? clave === mesActual;
  const claveVisible = mesCalendario ?? (meses.some(mes => mes.clave === mesActual) ? mesActual : meses[0]?.clave);
  const indiceMes = meses.findIndex(mes => mes.clave === claveVisible);
  const mes = meses[indiceMes];
  const cabeceras = [0, 1, 2, 3, 4, 5, 6].map(i => new Intl.DateTimeFormat(idioma, { weekday: "narrow", timeZone: "UTC" })
    .format(new Date(Date.UTC(2024, 0, 1 + i)))); // 1 de enero de 2024 fue lunes.

  useEffect(() => { cerrarRef.current?.focus(); }, []);
  useHojaAtras(true, cerrar);

  // Antes de ir a otro acertijo, la hoja deja de ser historial: cerrarla no debe deshacer la navegación.
  function irDesdeHoja() {
    soltarHoja();
    cerrar();
  }

  function irAlNumero(evento: FormEvent) {
    evento.preventDefault();
    const numero = Number(irA);
    if (!Number.isInteger(numero) || !numeros.has(numero)) { setAviso(t("cr_fuera_de_rango")); return; }
    irDesdeHoja();
    router.push(rutaNumero(idioma, numero));
  }

  function fila(entrada: EntradaIndice) {
    const hecho = resueltoLocal(idioma, entrada.numero);
    const conAyuda = ayudaLocal(idioma, entrada.numero);
    return <li key={entrada.numero}>
      <Link href={rutaNumero(idioma, entrada.numero)} onClick={irDesdeHoja} aria-current={actual === entrada.numero ? "page" : undefined}>
        <span>{t("cr_numero", { n: entrada.numero })} · {corta(entrada.fecha)}</span>
        <span>{t(conAyuda ? "cr_hecho_ayuda" : hecho ? "cr_hecho" : "cr_pendiente")}</span>
      </Link>
    </li>;
  }

  const resultados = buscar(lista, consulta, corta);
  return <div className="cr-bienvenida" onClick={evento => { if (evento.target === evento.currentTarget) cerrar(); }}>
    <section className="cr-hoja cr-archivo-hoja" role="dialog" aria-modal="true" aria-labelledby="cr-archivo-titulo">
      <div className="cr-grabber" aria-hidden="true" />
      <div className="cr-hoja-cab">
        <h2 id="cr-archivo-titulo">{t("cr_archivo_titulo")}</h2>
        <button ref={cerrarRef} type="button" className="cr-enlace" onClick={cerrar}>{t("cr_cerrar")}</button>
      </div>
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
      {error && <p role="status" className="cr-nota">{t("cr_error")}</p>}
      {!indice && !error && <Esqueleto variante="lista" etiqueta={t("cr_cargando")} />}
      {vista === "lista" && consulta.trim() && <ul className="cr-lista-archivo">
        {resultados.length ? resultados.map(fila) : <li className="cr-nota">{t("cr_sin_coincidencias")}</li>}
      </ul>}
      {vista === "lista" && !consulta.trim() && meses.map(grupo => {
        const resueltos = grupo.entradas.filter(entrada => resueltoLocal(idioma, entrada.numero)).length;
        return <section key={grupo.clave} className="cr-mes">
          <button type="button" className="cr-mes-cab" aria-expanded={expandido(grupo.clave)}
            onClick={() => setPliegues(previo => ({ ...previo, [grupo.clave]: !expandido(grupo.clave) }))}>
            <b>{fechaCorta(idioma, `${grupo.clave}-01`, { month: "long", year: "numeric" })}</b>
            <small>{t("cr_resueltos", { n: resueltos, total: grupo.entradas.length })}</small>
          </button>
          {expandido(grupo.clave) && <ul className="cr-lista-archivo">{grupo.entradas.map(fila)}</ul>}
        </section>;
      })}
      {vista === "calendario" && mes && <section className="cr-mes">
        <div className="cr-mes-nav">
          <button type="button" className="cr-enlace" aria-label={t("cr_mes_anterior")} disabled={indiceMes >= meses.length - 1}
            onClick={() => setMesCalendario(meses[indiceMes + 1].clave)}>‹</button>
          <b>{fechaCorta(idioma, `${mes.clave}-01`, { month: "long", year: "numeric" })}</b>
          <button type="button" className="cr-enlace" aria-label={t("cr_mes_siguiente")} disabled={indiceMes <= 0}
            onClick={() => setMesCalendario(meses[indiceMes - 1].clave)}>›</button>
        </div>
        <div className="cr-cuadricula">
          {cabeceras.map((letra, i) => <span key={i} className="cr-cab-dia" aria-hidden="true">{letra}</span>)}
          {cuadriculaDelMes(mes.clave).map((celda, i) => {
            if (!celda) return <span key={i} className="cr-celda vacia" aria-hidden="true" />;
            const entrada = porFecha.get(celda.fecha);
            if (!entrada) return <span key={i} className="cr-celda sin">{celda.dia}</span>;
            const hecho = resueltoLocal(idioma, entrada.numero);
            return <Link key={i} href={rutaNumero(idioma, entrada.numero)} onClick={irDesdeHoja}
              aria-current={actual === entrada.numero ? "page" : undefined}
              aria-label={`${t("cr_numero", { n: entrada.numero })}: ${t(hecho ? "cr_hecho" : "cr_pendiente")}`}
              className={`cr-celda${hecho ? " hecho" : ""}${entrada.numero === ultimo ? " hoy" : ""}`}>{celda.dia}</Link>;
          })}
        </div>
      </section>}
    </section>
  </div>;
}
