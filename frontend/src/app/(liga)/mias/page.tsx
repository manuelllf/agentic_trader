"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useConfirmar } from "@/components/Confirmar";
import { normalizeLocale } from "@/i18n/locale";
import {
  apuntar as apuntarApi, borrarEstrategia, cadaDia1, desapuntar, getClasificacion, getJornadaPublica, getPortada,
  miVentana, misEstrategias, optarAlPremio, type Clasificacion, type Estrategia, type JornadaDetalle, type Portada, type Ventana,
} from "@/lib/liga/api";
import { mutar, useCache } from "@/lib/liga/cache";
import { fecha, porcentaje, signo } from "@/lib/liga/format";
import { getSeguimiento, type SeguimientoEstrategia } from "@/lib/liga/seguimiento";
import { BarraPestanas, CabeceraApp, ErrorLiga, cierreDeCambios } from "../_ui";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { claseDe } from "../liga/ListaRanking";
import { FilaEstrategia, type Pildora } from "./FilaEstrategia";
import "../liga/ranking.css";
import "./mias.css";

type ListaEstrategias = Estrategia[] | string;
type Modo = "vs" | "rent";
const MODOS: Modo[] = ["vs", "rent"];

// Conserva la lista cacheada y actualiza solo la estrategia afectada.
function parchearFila(id: string, cambios: Partial<Estrategia>) {
  mutar<ListaEstrategias>("mis-estrategias", (prev) => (
    Array.isArray(prev) ? prev.map((e) => (e.id === id ? { ...e, ...cambios } : e)) : prev ?? []));
}

/** Esqueleto con la forma de la fila: baldosa, nombre, subtítulo y píldora. */
function Esqueleto() {
  const t = useTranslations();
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{t("common_cargando")}</span>
      <div aria-hidden="true">
        <span className="esqueleto-bloque mi-esq-cuenta" />
        <span className="esqueleto-bloque mi-esq-cab" />
        <ul className="mi-grupo">
          {[62, 70, 48].map((ancho, i) => (
            <li key={i} className="mi-fila">
              <span className="mi-abre">
                <span className="esqueleto-bloque" style={{ width: 32, height: 32, borderRadius: 9 }} />
                <span className="lv-nombre">
                  <span className="esqueleto-bloque" style={{ display: "block", width: `${ancho}%`, height: 16 }} />
                  <span className="esqueleto-bloque" style={{ display: "block", width: "40%", height: 13, marginTop: 7 }} />
                </span>
              </span>
              <span className="esqueleto-bloque" style={{ width: 70, height: 32, borderRadius: 8 }} />
              <span />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Aviso breve sobre la barra (DESIGN §7): confirma lo ya hecho o cuenta un fallo, y se va solo. */
function Aviso({ texto, error, alFin }: { texto: string; error: boolean; alFin: () => void }) {
  useEffect(() => {
    const id = setTimeout(alFin, 3500);
    return () => clearTimeout(id);
  }, [texto, alFin]);
  return <div className="mi-aviso" role={error ? "alert" : "status"}>{texto}</div>;
}

export default function Mias() {
  const t = useTranslations();
  const router = useRouter();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const { confirmar, dialogo } = useConfirmar();
  const { estado, yo } = useSesionRequerida("/mias");
  const dentro = estado === "dentro";

  const { datos: estrategias, fallo, refrescar } = useCache<ListaEstrategias>(
    estado !== "cargando" && dentro ? "mis-estrategias" : null, misEstrategias);
  const lista = Array.isArray(estrategias) ? estrategias : [];
  const hayJugando = lista.some((e) => e.estado === "jugando");
  const { datos: portada, fallo: falloPortada } = useCache<Portada | string>("portada", getPortada, 120000);
  const temporada = typeof portada === "object" && portada ? portada.temporada : null;
  const jornadaId = typeof portada === "object" && portada ? portada.en_juego?.id ?? null : null;
  const pideClasificacion = dentro && !!yo && hayJugando && !!temporada;
  const { datos: clasificacion, fallo: falloClasificacion } = useCache<Clasificacion | string>(
    pideClasificacion ? `clasificacion:${yo?.alias ?? ""}` : null, () => getClasificacion({ alias: yo?.alias }), 120000);
  const { datos: jornada, fallo: falloJornada } = useCache<JornadaDetalle | string>(
    hayJugando && jornadaId !== null ? `jornada:${jornadaId}` : null, () => getJornadaPublica(jornadaId as number), 120000);
  const { datos: seguimiento, fallo: falloSeguimiento } = useCache<SeguimientoEstrategia[] | string>(
    dentro ? "seguimiento" : null, getSeguimiento);
  const { datos: ventanas, fallo: falloVentanas } = useCache<Ventana[] | string>(dentro ? "ventana" : null, miVentana);

  const [indiceModo, setIndiceModo] = useState(0);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);
  const modo = MODOS[indiceModo];
  const cerrarAviso = useCallback(() => setAviso(null), []);

  // Todo llega a la vez: hasta tener cada dato (o su fallo) solo se ve el esqueleto, nunca cifras sueltas.
  const llego = (dato: unknown, fallado: boolean, hace: boolean = true) => !hace || dato !== undefined || fallado;
  const listo = Array.isArray(estrategias)
    && llego(seguimiento, falloSeguimiento) && llego(ventanas, falloVentanas)
    && llego(portada, falloPortada)
    && llego(clasificacion, falloClasificacion, pideClasificacion)
    && llego(jornada, falloJornada, hayJugando && jornadaId !== null);

  const porSeguimiento = Array.isArray(seguimiento) ? new Map(seguimiento.map((r) => [r.estrategia_id, r])) : null;
  const porVentana = Array.isArray(ventanas) ? new Map(ventanas.map((v) => [v.estrategia_id, v])) : null;
  const porClasificacion = typeof clasificacion === "object" && clasificacion
    ? new Map([...clasificacion.filas, ...clasificacion.mias].filter((f) => f.equipo.id !== null).map((f) => [f.equipo.id, f])) : null;
  const totalClasificacion = typeof clasificacion === "object" && clasificacion ? clasificacion.total : null;
  const porJornada = typeof jornada === "object" && jornada
    ? new Map(jornada.filas.filter((f) => f.equipo.id !== null).map((f) => [f.equipo.id, f])) : null;

  /** La novedad desde tu última revisión: cambios en cartera o un resultado nuevo. */
  const novedadDe = (id: string): string | null => {
    const r = porSeguimiento?.get(id);
    if (!r || r.primera_revision) return null;
    const c = r.cambio_desde_revision;
    if (c && (c.entradas.length || c.salidas.length)) return t("strategies_change_count", { count: c.entradas.length + c.salidas.length });
    return r.resultado_nuevo ? t("mias_nuevo_resultado") : null;
  };
  /** La ventana de cambios, si toca: abierta hasta una hora, formándose o con la cartera nueva lista. */
  const ventanaDe = (id: string): string | null => {
    const v = porVentana?.get(id);
    if (!v) return null;
    if (v.fase === "cambios") { const c = cierreDeCambios(v.cierra, locale); return t("mias_cambios_hasta", { date: c.dia, time: c.hora }); }
    if (v.fase === "formando") return t("window_mine_forming");
    return v.proxima?.length ? t("window_mine_proxima") : null;
  };
  const subtitulo = (e: Estrategia): [string, boolean] => {
    const novedad = e.estado === "jugando" ? novedadDe(e.id) : null;
    if (novedad) return [novedad, true];
    if (e.estado === "borrador") return [t("mias_sin_apuntar"), false];
    const ventana = ventanaDe(e.id);
    if (ventana) return [ventana, true];
    if (e.estado === "apuntada") return [t("mias_entra_proxima"), false];
    const fila = porClasificacion?.get(e.id);
    if (fila && totalClasificacion) {
      return [`${t("mias_puesto", { puesto: fila.posicion, total: totalClasificacion })} · ${t("strategies_points", { count: fila.puntos })}`, false];
    }
    return [t("strategies_state_playing"), false];
  };
  const pildoraDe = (e: Estrategia): Pildora | null => {
    if (e.estado !== "jugando") return null;
    const f = porJornada?.get(e.id);
    const vs = f?.dif_sp ?? null, rent = f?.rentabilidad ?? null;
    if (vs == null && rent == null) return null;
    const texto = modo === "vs" ? (vs == null ? "-" : signo(Number(vs), 1, locale)) : (rent == null ? "-" : porcentaje(Number(rent), 1, locale));
    return { texto, clase: claseDe(vs == null ? null : Number(vs)), etiqueta: `${texto}, ${t("league_cambiar_dato")}` };
  };

  const avisar = (texto: string, error = false) => setAviso({ texto, error });
  async function conOcupada<T>(id: string, fn: () => Promise<T>): Promise<T> {
    setOcupada(id);
    try { return await fn(); } finally { setOcupada(null); }
  }
  const accionesDe = (e: Estrategia) => ({
    alCiclar: () => setIndiceModo((i) => (i + 1) % MODOS.length),
    alEditar: () => router.push(`/crear/${e.id}`),
    alApuntar: () => void conOcupada(e.id, async () => {
      const r = await apuntarApi(e.id);
      if (typeof r === "string") avisar(r, true);
      else { parchearFila(e.id, r); avisar(t("mias_aviso_apuntada", { name: e.nombre })); }
    }),
    alQuitar: () => void conOcupada(e.id, async () => {
      const r = await desapuntar(e.id);
      if (typeof r === "string") avisar(r, true);
      else { parchearFila(e.id, r); avisar(t("mias_aviso_quitada", { name: e.nombre })); }
    }),
    alPremio: () => void conOcupada(e.id, async () => {
      const r = await optarAlPremio(e.id);
      if (typeof r === "string") avisar(r, true);
      else { mutar<ListaEstrategias>("mis-estrategias", () => r); avisar(t("mias_aviso_premio", { name: e.nombre })); }
    }),
    // Optimista: la marca cambia al tocar y se confirma (o se deshace) con lo que responda el servidor.
    alCadaMes: (opcion: "revisar" | "mantener") => void conOcupada(e.id, async () => {
      const anterior = mutar<ListaEstrategias>("mis-estrategias", (prev) => (
        Array.isArray(prev) ? prev.map((x) => (x.id === e.id ? { ...x, cada_dia_1: opcion } : x)) : prev ?? []));
      const r = await cadaDia1(e.id, opcion);
      if (typeof r === "string") {
        avisar(r, true);
        if (anterior !== undefined) mutar<ListaEstrategias>("mis-estrategias", () => anterior);
      } else parchearFila(e.id, r);
    }),
    alBorrar: async () => {
      if (!(await confirmar({ titulo: t("strategies_delete_draft_title", { name: e.nombre }), texto: t("strategies_delete_draft_body"),
        aceptar: t("strategies_delete_draft_action"), peligro: true }))) return;
      await conOcupada(e.id, async () => {
        const r = await borrarEstrategia(e.id);
        if (typeof r === "string") avisar(r, true);
        else mutar<ListaEstrategias>("mis-estrategias", (prev) => (Array.isArray(prev) ? prev.filter((x) => x.id !== e.id) : prev ?? []));
      });
    },
  });

  const grupo = (titulo: string, filas: Estrategia[], derecha?: string) => filas.length > 0 && (
    <section key={titulo}>
      <p className="lv-lista-cab"><span>{titulo}</span>{derecha && <span><b>{derecha}</b></span>}</p>
      <ul className="mi-grupo">
        {filas.map((e) => {
          const [sub, nuevo] = subtitulo(e);
          return <FilaEstrategia key={e.id} estrategia={e} sub={sub} nuevo={nuevo} pildora={pildoraDe(e)}
            ocupada={ocupada === e.id} acciones={accionesDe(e)} />;
        })}
      </ul>
    </section>
  );

  let contenido;
  if (fallo || typeof estrategias === "string") {
    contenido = <ErrorLiga titulo={t("strategies_mine_error")}
      mensaje={typeof estrategias === "string" ? estrategias : t("mias_error_texto")}
      accion={{ texto: t("strategies_retry"), onClick: refrescar }} />;
  } else if (!listo) {
    contenido = <Esqueleto />;
  } else if (lista.length === 0) {
    contenido = (
      <div className="mi-vacio">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3.5l8.5 4.6L12 12.7 3.5 8.1z" /><path d="M3.5 12.4L12 17l8.5-4.6M3.5 16.4L12 21l8.5-4.6" />
        </svg>
        <h2>{t("strategies_empty_title")}</h2>
        <p>{t("strategies_empty_text")}</p>
        <button type="button" className="mi-boton" onClick={() => router.push("/crear")}>{t("strategies_create_first")}</button>
      </div>
    );
  } else {
    const jugando = lista.filter((e) => e.estado === "jugando");
    const apuntadas = lista.filter((e) => e.estado === "apuntada");
    const borradores = lista.filter((e) => e.estado === "borrador");
    const conNovedad = jugando.filter((e) => novedadDe(e.id)).length;
    const sp = typeof jornada === "object" && jornada ? jornada.jornada.sp_rentabilidad : null;
    const proxima = typeof portada === "object" && portada ? portada.proxima : null;
    const hasta = typeof jornada === "object" && jornada ? jornada.hasta ?? jornada.jornada.dia_fin : null;
    contenido = (
      <>
        <p className="mi-cuenta">
          {t("strategies_count", { count: lista.length })}
          {conNovedad > 0 && <> · <b>{t("strategies_with_news", { count: conNovedad })}</b></>}
        </p>
        {grupo(`${t("league_este_mes")} · S&P ${sp == null ? "-" : porcentaje(Number(sp), 1, locale)}`, jugando,
          t(modo === "vs" ? "league_modo_vs" : "league_orden_rentabilidad"))}
        {grupo(proxima ? t("mias_jornada", { numero: proxima.numero }) : t("strategies_state_signed_up"), apuntadas)}
        {grupo(t("mias_borradores"), borradores)}
        {jugando.length > 0 && hasta && <p className="lv-pie">{t("mias_pie", { date: fecha(hasta, new Date(), locale) })}</p>}
      </>
    );
  }

  return (
    <main className="scroll lv-pagina mi">
      <CabeceraApp titulo={t("strategies_mine_title")} derecha={
        <button type="button" className="mi-crear" aria-label={t("strategies_create")} onClick={() => router.push("/crear")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
            <path d="M12 4.5v15M4.5 12h15" />
          </svg>
        </button>} />
      {contenido}
      {aviso && <Aviso texto={aviso.texto} error={aviso.error} alFin={cerrarAviso} />}
      <BarraPestanas />
      {dialogo}
    </main>
  );
}
