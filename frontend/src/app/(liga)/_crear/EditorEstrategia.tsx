"use client";

// La selección puede probarse sin crear estrategia; guardar o inscribir requiere identidad.

import { ACTUALIZACION_VISIBLE, LECTURA_VISIBLE, PREGUNTA_VISIBLE } from "@/lib/liga/funciones";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import { BarraPestanas, CabeceraApp, ErrorLiga, escudoAleatorio, type EscudoValor } from "../_ui";
import {
  actualizarEstrategia, apuntar, buscarUniverso, costeProbarConPregunta,
  crearEstrategia, crearReceta, excluirEmpresa, getCatalogo, getFicha,
  leerAFondo, lecturasCompradas, porQueNoSale, probarEstrategia, quitarExclusion, verEstrategia,
  leerBorrador, vincularBorrador, type ContenidoBorrador,
  type Catalogo, type CostePregunta, type EmpresaBusqueda, type Estrategia, type EstrategiaPatch,
  previsualizarSeleccion, getMercado, type Mercado, type InterpretacionIdea, type Lectura, type Prueba, type PreviewSeleccion,
  type RecetaEntrada, type ReglaElegida,
} from "@/lib/liga/api";
import { invalidar, obtener } from "@/lib/liga/cache";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { miles } from "@/lib/liga/format";
import { pesosCoherentes } from "@/lib/liga/receta";
import { SegmentoLiga } from "../liga/SegmentoLiga";
import { PasoRevisar } from "./PasoRevisar";
import { LecturasModal } from "./LecturasModal";
import { useAutoguardado } from "./useAutoguardado";
import { CarteraViva, type EmpresaViva } from "./CarteraViva";
import { PasoReglas } from "./PasoReglas";
import { PasoIdea } from "./PasoIdea";
import { PasoCartera } from "./PasoCartera";
import { PasoCriterios } from "./PasoCriterios";
import { CarteraHoja } from "./CarteraHoja";
import { diferenciaCartera } from "./diferencias";
import { useDeshacer } from "./useDeshacer";
import { AvisoCrear, IconoAtras } from "./piezas";
import "../liga/ranking.css";
import "./constructor.css";
const RUTA_ACTUAL = (id?: string) => (id ? `/crear/${id}` : "/crear");
const ETAPAS = ["builder_step_idea", "builder_step_rules", "builder_step_criteria", "builder_step_portfolio", "builder_step_review"];
const PREGUNTAS = ["builder_idea_titulo", "builder_question_rules", "builder_question_criteria", "builder_question_portfolio", "builder_question_review"];
const ESTADOS_SIN_AVISO = ["Guardado", "Guardando…", "Cambios pendientes"];
type PruebaVista = Omit<Prueba, "id" | "foto_id" | "scan_run_id"> & { id: string | null; foto_id: number | null; scan_run_id: number | null };

type Borrador = {
  reglas: ReglaElegida[];
  interpretacion: InterpretacionIdea[];
  excluidas: string[];
  pregunta: string;
  pesos: Record<string, number>;
  n_empresas: number;
  reparto: string;
  max_por_sector: number;
};

function borradorInicial(cat: Catalogo): Borrador {
  return {
    reglas: [],
    interpretacion: [],
    excluidas: [],
    pregunta: "",
    pesos: Object.fromEntries(cat.pesos.claves.map((k) => [k, k === "pregunta" ? 0 : 20])),
    n_empresas: cat.n_empresas.includes(5) ? 5 : cat.n_empresas[0],
    reparto: cat.repartos[0],
    max_por_sector: 0,
  };
}

/** El escudo tal como lo pide la API: `color2` siempre relleno (la API lo exige) e `iniciales`
 *  `null` en vez de cadena vacía (el patrón del backend exige 1-2 caracteres si se manda algo). */
function escudoParaApi(cr: EscudoValor) {
  return {
    forma: cr.forma, dibujo: cr.dibujo, color1: cr.color1, color2: cr.color2 || cr.color1,
    iniciales: cr.iniciales?.trim() ? cr.iniciales.trim() : null,
  };
}

/** Esqueleto de un paso: título, el campo y una lista con dos líneas y una cifra por fila. */
function EsqueletoPaso() {
  const t = useTranslations();
  return <div role="status" aria-live="polite">
    <span className="sr-only">{t("common_cargando")}</span>
    <div aria-hidden="true">
      <span className="cr-esq" style={{ width: "62%", height: 24, marginTop: 26, borderRadius: 7 }} />
      <div className="cr-grupo" style={{ marginTop: 16, height: 96 }} />
      <span className="cr-esq" style={{ width: "38%", height: 13, margin: "30px 16px 8px" }} />
      <div className="cr-grupo">{[56, 44, 60, 40].map(w => <div className="cr-celda" key={w}>
        <span className="t"><span className="cr-esq" style={{ width: `${w}%`, height: 16 }} />
          <span className="cr-esq" style={{ width: `${w + 18}%`, height: 13, marginTop: 6 }} /></span>
        <span className="cr-esq" style={{ width: 34, height: 16 }} />
      </div>)}</div>
    </div>
  </div>;
}

export function EditorEstrategia({ estrategiaIdInicial, antes }: { estrategiaIdInicial?: string; antes?: ReactNode }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const router = useRouter();
  const etapaUrl = useSearchParams().get("etapa");
  const { estado, yo } = useSesionRequerida(RUTA_ACTUAL(estrategiaIdInicial));
  const sesionLista = estado !== "cargando";

  const [catalogo, setCatalogo] = useState<Catalogo | string | null>(null);
  const [id, setId] = useState<string | undefined>(estrategiaIdInicial);
  const [estrategia, setEstrategia] = useState<Estrategia | null>(null);
  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  // Mercado y primera vista llegan con el catálogo: la pantalla no pinta nada hasta tener los tres.
  const [mercado, setMercado] = useState<Mercado | null>(null);
  const [mercadoListo, setMercadoListo] = useState(false);

  const [nombre, setNombre] = useState("");
  const [errorNombre, setErrorNombre] = useState(false);
  const [cr, setCr] = useState<EscudoValor>(() => escudoAleatorio());
  const [b, setB] = useState<Borrador | null>(null);
  const deshacer = useDeshacer();
  const [hojaAbierta, setHojaAbierta] = useState(false);
  const cerrarHoja = useCallback(() => setHojaAbierta(false), []);
  const ultimaCartera = useRef<EmpresaViva[] | null>(null);
  const [movimientos, setMovimientos] = useState<{ entran: string[]; salen: EmpresaViva[] }>({ entran: [], salen: [] });
  const [avisoCartera, setAvisoCartera] = useState<string | null>(null);
  const [visibilidad, setVisibilidad] = useState<"privada" | "publicada">("privada");
  const [declaraPosiciones, setDeclaraPosiciones] = useState<"si" | "no" | null>(null);
  const [cadaDia1Opcion, setCadaDia1Opcion] = useState<"revisar" | "mantener">("revisar");
  const [etapa, setEtapa] = useState(0);
  const [revisionInicial, setRevisionInicial] = useState<number | null>(null);
  const etapaRef = useRef<HTMLHeadingElement>(null);

  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prueba, setPrueba] = useState<PruebaVista | string | null>(null);
  const [previewDato, setPreviewDato] = useState<{ clave: string; valor: PreviewSeleccion } | null>(null);
  const [previewSeleccionError, setPreviewSeleccionError] = useState<string | null>(null);
  const [previewSeleccionCargando, setPreviewSeleccionCargando] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAbort = useRef<AbortController | null>(null);
  const previewSeq = useRef(0);
  const previewUltimaPeticion = useRef(0);
  const previews = useRef(new Map<string, { fecha: number; valor: PreviewSeleccion }>());
  const [cambio, setCambio] = useState<{ entra: string; sale: string } | null>(null);
  const [costePregunta, setCostePregunta] = useState<CostePregunta | null>(null);
  const [leyendo, setLeyendo] = useState<string | null>(null);      // ticker en curso, o "cartera"
  const [lecturas, setLecturas] = useState<Lectura[]>([]);
  const [modalLecturas, setModalLecturas] = useState(false);
  const [tickersLecturas, setTickersLecturas] = useState<string[]>([]);
  const [tickerLectura, setTickerLectura] = useState<string | null>(null);
  const [errorLectura, setErrorLectura] = useState<string | null>(null);
  const contextoLecturas = useRef<string | null>(null);
  const lecturaEnCurso = useRef(false);
  const [buscaQ, setBuscaQ] = useState("");
  const [sugerencias, setSugerencias] = useState<EmpresaBusqueda[]>([]);
  const [porque, setPorque] = useState<{ ticker: string; nombre: string; texto: string } | null>(null);

  const [convFrase, setConvFrase] = useState("");
  const [convOcupado, setConvOcupado] = useState(false);
  const [convQuedan, setConvQuedan] = useState<number | null>(null);
  const [usarFrescas, setUsarFrescas] = useState(false);
  const [revisionDatos, setRevisionDatos] = useState(0);
  const alActualizarDatos = useCallback(() => {
    previews.current.clear();
    setUsarFrescas(true);
    setRevisionDatos(n => n + 1);
  }, []);
  const recetaPreview = useMemo((): (RecetaEntrada & { usar_frescas?: boolean }) | null => {
    if (!b) return null;
    const { pregunta, pesos } = pesosCoherentes(b.pregunta, b.pesos);
    return { usar_frescas: usarFrescas, idea: convFrase || null, reglas: b.reglas, excluidas: b.excluidas, pregunta, pesos,
      n_empresas: b.n_empresas, reparto: b.reparto, max_por_sector: b.max_por_sector };
  }, [b, convFrase, usarFrescas]);
  const clavePreview = JSON.stringify(recetaPreview);
  // Lo último que llegó: mientras llega lo nuevo se ve lo anterior, nunca un cero falso.
  const previewSeleccion = previewDato?.valor ?? null;

  useEffect(() => {
    if (!previewSeleccion) return;
    const anteriores = ultimaCartera.current;
    const siguientes = previewSeleccion.elegidas;
    if (anteriores) {
      const dif = diferenciaCartera(anteriores.map(e => e.ticker), siguientes.map(e => e.ticker));
      if (dif.entra.length || dif.sale.length) setMovimientos({ entran: dif.entra, salen: anteriores.filter(e => dif.sale.includes(e.ticker)) });
    }
    ultimaCartera.current = siguientes;
  }, [previewSeleccion]);

  // El aviso de deshacer solo sale cuando la cartera cambia de verdad, y dice qué entra y qué sale.
  const deshacerDisponible = deshacer.disponible;
  useEffect(() => {
    if (!deshacerDisponible || (!movimientos.entran.length && !movimientos.salen.length)) return;
    const lista = (tickers: string[]) => tickers.slice(0, 2).join(", ") + (tickers.length > 2 ? "…" : "");
    const partes = [
      movimientos.entran.length ? t("builder_aviso_entra", { count: movimientos.entran.length, tickers: lista(movimientos.entran) }) : "",
      movimientos.salen.length ? t("builder_aviso_sale", { count: movimientos.salen.length, tickers: lista(movimientos.salen.map(e => e.ticker)) }) : "",
    ].filter(Boolean);
    setAvisoCartera(t("builder_aviso_cartera", { cambios: partes.join(", ") }));
  }, [movimientos, deshacerDisponible, t]);
  const cerrarAviso = useCallback(() => setAvisoCartera(null), []);

  const contenido: ContenidoBorrador | null = b ? {
    nombre, idea: convFrase, etapa, escudo: escudoParaApi(cr),
    receta: {
      reglas: b.reglas, excluidas: b.excluidas, pregunta: b.pregunta, pesos: b.pesos,
      n_empresas: b.n_empresas, reparto: b.reparto, max_por_sector: b.max_por_sector,
    },
    interpretacion: b.interpretacion,
    visibilidad, declara_posiciones: declaraPosiciones, cada_dia_1: cadaDia1Opcion,
  } : null;
  const autoguardado = useAutoguardado(id ?? "nueva", revisionInicial, contenido);

  useEffect(() => {
    // También se ejecuta al pulsar Crear desde la barra, sin desmontar el editor.
    setEtapa(etapaUrl !== null && /^[0-4]$/.test(etapaUrl) ? Number(etapaUrl) : 0);
  }, [etapaUrl]);

  const nombreRef = useRef<HTMLInputElement>(null);
  const buscaId = useRef(0);
  const buscaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buscaAbort = useRef<AbortController | null>(null);

  // Limpieza al desmontar: no dejar un timer o una petición colgando.
  useEffect(() => () => {
    if (buscaTimer.current) clearTimeout(buscaTimer.current);
    buscaAbort.current?.abort();
  }, []);

  // Vista determinista en vivo: usa solo la última foto y sus puntuaciones guardadas. El borrador
  // no se guarda ni se convierte en una estrategia para pedir esta información.
  useEffect(() => {
    if (clavePreview === "null" || estado !== "dentro") {
      setPreviewDato(null);
      setPreviewSeleccionError(null);
      setPreviewSeleccionCargando(false);
      return;
    }
    const receta: RecetaEntrada = JSON.parse(clavePreview);
    const seq = ++previewSeq.current;
    setPreviewSeleccionError(null);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewAbort.current?.abort();
    const guardada = previews.current.get(clavePreview);
    if (guardada && Date.now() - guardada.fecha < 120_000) {
      setPreviewDato({ clave: clavePreview, valor: guardada.valor });
      setPreviewSeleccionCargando(false);
      return;
    }
    setPreviewSeleccionCargando(true);
    const intervalo = Math.max(200, 2_500 - (Date.now() - previewUltimaPeticion.current));
    previewTimer.current = setTimeout(() => {
      const controller = new AbortController();
      previewAbort.current = controller;
      previewUltimaPeticion.current = Date.now();
      void previsualizarSeleccion(receta, controller.signal).then((r) => {
        if (seq !== previewSeq.current || controller.signal.aborted) return;
        if (typeof r === "string") setPreviewSeleccionError(r);
        else {
          if (previews.current.size >= 8) previews.current.delete(previews.current.keys().next().value!);
          previews.current.set(clavePreview, { fecha: Date.now(), valor: r });
          setPreviewDato({ clave: clavePreview, valor: r });
        }
      }).catch((err: unknown) => {
        if (seq !== previewSeq.current || controller.signal.aborted) return;
        setPreviewSeleccionError(err instanceof Error ? err.message : t("builder_preview_refresh_error"));
      }).finally(() => {
        if (seq === previewSeq.current && !controller.signal.aborted) setPreviewSeleccionCargando(false);
      });
    }, intervalo);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewAbort.current?.abort();
    };
  }, [clavePreview, estado, revisionDatos]);

  // Catálogo (caché compartida con la portada y `crear/[id]`, ver H3 del informe de fluidez) +
  // (si se edita) la estrategia y su receta vigente.
  useEffect(() => {
    if (!sesionLista || estado !== "dentro") return;
    let vivo = true;
    void getMercado().catch(() => null).then((r) => {
      if (!vivo) return;
      if (r && typeof r !== "string") setMercado(r);
      setMercadoListo(true);
    });
    (async () => {
      setCargandoInicial(true);
      const cat = await obtener("catalogo", getCatalogo);
      if (!vivo) return;
      setCatalogo(cat);
      if (typeof cat === "string") { setCargandoInicial(false); return; }
      if (estrategiaIdInicial) {
        const [est, ficha] = await Promise.all([
          verEstrategia(estrategiaIdInicial), getFicha(estrategiaIdInicial),
        ]);
        if (!vivo) return;
        if (typeof est === "string") { setErrorCarga(est); setCargandoInicial(false); return; }
        setEstrategia(est);
        setNombre(est.nombre);
        setCr({ forma: est.escudo.forma, dibujo: est.escudo.dibujo, color1: est.escudo.color1,
                 color2: est.escudo.color2, iniciales: est.escudo.iniciales });
        setVisibilidad(est.visibilidad);
        setDeclaraPosiciones(est.declara_posiciones);
        setCadaDia1Opcion(est.cada_dia_1 === "mantener" ? "mantener" : "revisar");
        const receta = typeof ficha === "string" ? null : ficha.receta;
        setConvFrase(receta?.idea ?? "");
        setB(receta ? {
          reglas: receta.reglas, interpretacion: [], excluidas: receta.excluidas,
          pregunta: receta.pregunta ?? "",
          pesos: { ...borradorInicial(cat).pesos, ...receta.pesos }, n_empresas: receta.n_empresas,
          reparto: receta.reparto, max_por_sector: receta.max_por_sector,
        } : borradorInicial(cat));
      } else {
        setB(borradorInicial(cat));
      }
      const borrador = await leerBorrador(estrategiaIdInicial ?? "nueva");
      if (!vivo) return;
      if (typeof borrador === "string") {
        setErrorCarga(borrador); setCargandoInicial(false); return;
      }
      if (borrador) {
        const d = borrador.contenido;
        setNombre(d.nombre); setCr(d.escudo); setConvFrase(d.idea);
        setB({ ...d.receta, interpretacion: d.interpretacion ?? [],
          pregunta: d.receta.pregunta ?? "" });
        setVisibilidad(d.visibilidad); setDeclaraPosiciones(d.declara_posiciones);
        setCadaDia1Opcion(d.cada_dia_1);
      }
      const pasoUrl = new URLSearchParams(window.location.search).get("etapa");
      // Entrar desde Crear o Editar empieza en Idea; los campos del borrador sí se recuperan.
      setEtapa(pasoUrl !== null && /^[0-4]$/.test(pasoUrl) ? Number(pasoUrl) : 0);
      setRevisionInicial(borrador?.revision ?? 0);
      setCargandoInicial(false);
    })();
    return () => { vivo = false; };
  }, [sesionLista, estado, estrategiaIdInicial]);

  useEffect(() => {
    if (cargandoInicial || !etapaRef.current) return;
    const frame = requestAnimationFrame(() => {
      etapaRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [etapa, cargandoInicial]);

  const pro = yo?.plan === "pro";
  const titulo = estrategiaIdInicial ? t("builder_edit_title") : t("builder_new_title");
  const opcionesEtapas = ETAPAS.map((clave, i) => ({ valor: i, etiqueta: t(clave) }));

  if (!sesionLista || cargandoInicial) {
    return (
      <main className="scroll lv-pagina cr constructor" aria-busy="true">
        <CabeceraApp titulo={titulo} />
        <SegmentoLiga className="cr-etapas" etiquetaGrupo={t("builder_steps_aria")} valor={etapa} opciones={opcionesEtapas}
          onChange={() => undefined} desactivado />
        <EsqueletoPaso />
        <BarraPestanas />
      </main>
    );
  }
  if (typeof catalogo === "string") {
    return (
      <main className="scroll lv-pagina cr">
        <ErrorLiga titulo={t("builder_catalog_error")} mensaje={catalogo}
                   accion={{ texto: t("builder_retry"), onClick: () => window.location.reload() }} />
      </main>
    );
  }
  if (errorCarga) {
    return (
      <main className="scroll lv-pagina cr">
        <ErrorLiga titulo={t("builder_open_error")} mensaje={errorCarga}
                   accion={{ texto: t("builder_back_to_mine"), onClick: () => router.push("/mias") }} />
      </main>
    );
  }
  if (!catalogo || !b) return null;

  // Todo a la vez: mientras falte algo, esqueleto del cuerpo y sin barra, como en la maqueta. Nunca ceros ni guiones.
  if (!mercadoListo || !previewSeleccion) {
    if (previewSeleccionError) {
      return (
        <main className="scroll lv-pagina cr constructor">
          <CabeceraApp titulo={titulo} />
          <ErrorLiga titulo={t("builder_preview_refresh_error")} mensaje={previewSeleccionError}
                     accion={{ texto: t("builder_retry"), onClick: () => setRevisionDatos(n => n + 1) }} />
          <BarraPestanas />
        </main>
      );
    }
    return (
      <main className="scroll lv-pagina cr constructor" aria-busy="true">
        <CabeceraApp titulo={titulo} />
        <SegmentoLiga className="cr-etapas" etiquetaGrupo={t("builder_steps_aria")} valor={etapa} opciones={opcionesEtapas}
          onChange={() => undefined} desactivado />
        <EsqueletoPaso />
        <BarraPestanas />
      </main>
    );
  }

  const faltanReglas = b.reglas.length === 0;
  const puedeApuntarse = !faltanReglas && !(visibilidad === "publicada" && !declaraPosiciones);

  function irEtapa(siguiente: number) {
    cerrarHoja();
    setEtapa(siguiente);
    const url = new URL(window.location.href);
    url.searchParams.set("etapa", String(siguiente));
    window.history.pushState(null, "", url);
    void autoguardado.guardar();
  }

  function actualizarB(cambios: Partial<Borrador>, guardarDeshacer = true) {
    if (guardarDeshacer && b && Object.keys(cambios).some(k => ["reglas", "pesos", "n_empresas", "reparto", "max_por_sector", "excluidas"].includes(k))
        && Object.entries(cambios).some(([k, v]) => JSON.stringify(b[k as keyof Borrador]) !== JSON.stringify(v))) deshacer.guardar(b);
    setB((prev) => (prev ? { ...prev, ...cambios } : prev));
    actualizarPrueba(null);
    setCambio(null);
    contextoLecturas.current = null;
    setLecturas([]);
    setModalLecturas(false);
  }

  /** Crea la estrategia si hace falta, guarda una versión de la receta y devuelve su id. */
  async function guardar(): Promise<string | null> {
    if (!(await autoguardado.guardar())) { setError(t("builder_draft_save_error")); return null; }
    if (!nombre.trim()) {
      setErrorNombre(true);
      irEtapa(4);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        nombreRef.current?.scrollIntoView({ block: "center" });
        nombreRef.current?.focus({ preventScroll: true });
      }));
      return null;
    }
    setError(null);
    let idActual = id;
    const escudo = escudoParaApi(cr);
    if (!idActual) {
      const creada = await crearEstrategia(nombre.trim(), escudo);
      if (typeof creada === "string") { setError(creada); return null; }
      idActual = creada.id;
      const vinculada = await vincularBorrador(idActual, autoguardado.revision.current);
      if (typeof vinculada === "string") { setError(vinculada); return null; }
      setId(idActual);
      setEstrategia(creada);
      // Solo cambia la URL: `router.replace` monta la otra página y el editor pierde lo que hay.
      window.history.replaceState(null, "", `/crear/${idActual}?etapa=${etapa}`);
    } else if (estrategia && (estrategia.nombre !== nombre.trim()
      || estrategia.escudo.forma !== escudo.forma || estrategia.escudo.dibujo !== escudo.dibujo
      || estrategia.escudo.color1 !== escudo.color1 || estrategia.escudo.color2 !== escudo.color2
      || estrategia.escudo.iniciales !== escudo.iniciales)) {
      const cambiada = await actualizarEstrategia(idActual, { nombre: nombre.trim(), ...escudo });
      if (typeof cambiada === "string") { setError(cambiada); return null; }
      setEstrategia(cambiada);
    }
    const { pregunta, pesos } = pesosCoherentes(b!.pregunta, b!.pesos);
    const receta = await crearReceta(idActual, {
      idea: convFrase || null,
      reglas: b!.reglas, excluidas: b!.excluidas, pregunta, pesos, n_empresas: b!.n_empresas,
      reparto: b!.reparto, max_por_sector: b!.max_por_sector,
    });
    if (typeof receta === "string") { setError(receta); return null; }
    return idActual;
  }

  async function verQueEntrarian(receta = recetaPreview) {
    setOcupado(true);
    actualizarPrueba(null);
    setCambio(null);
    setCostePregunta(null);
    if (receta) {
      const r = await previsualizarSeleccion(receta);
      if (typeof r === "string") actualizarPrueba(r);
      else {
        const clave = JSON.stringify(receta);
        previews.current.set(clave, { fecha: Date.now(), valor: r });
        if (previews.current.size > 8) previews.current.delete(previews.current.keys().next().value!);
        setPreviewDato({ clave, valor: r });
        actualizarPrueba(r.estado === "sin_datos" ? r.mensaje : {
          id: null, foto_id: r.foto_id, scan_run_id: r.scan_run_id, plan_b: r.plan_b ?? false,
          catalogo_version: r.catalogo_version, evaluadas: r.evaluadas!, pasan: r.cumplen_reglas!,
          elegidas: r.elegidas, saltadas_por_sector: r.saltadas_por_sector!, sin_peso: r.sin_peso!,
          sin_notas: r.sin_notas!, sin_respuesta: r.sin_respuesta!, caja_pct: r.caja_pct!,
        });
      }
    }
    setOcupado(false);
  }

  async function guardarPrueba(): Promise<{ id: string; prueba: Prueba } | null> {
    const idActual = await guardar();
    if (!idActual) return null;
    const p = await probarEstrategia(idActual);
    actualizarPrueba(p);
    if (typeof p === "string") return null;
    if (b?.pregunta) {
      const c = await costeProbarConPregunta(idActual);
      if (typeof c !== "string") setCostePregunta(c);
    }
    return { id: idActual, prueba: p };
  }

  async function probarConPregunta() {
    setOcupado(true);
    const guardada = await guardarPrueba();
    if (!guardada) { setOcupado(false); return; }
    const p = await probarEstrategia(guardada.id, { idempotencia: crypto.randomUUID() });
    actualizarPrueba(p);
    if (typeof p !== "string") {
      setCostePregunta(null);   // ya está cobrada y en caché
      invalidar("creditos");    // gasta créditos: el chip de la cabecera tiene que refrescarse
    }
    setOcupado(false);
  }

  async function leerFicha(ticker: string) {
    await abrirLecturas([ticker]);
  }

  function actualizarPrueba(p: PruebaVista | string | null) {
    contextoLecturas.current = null;
    setLecturas([]);
    setModalLecturas(false);
    setPrueba(p);
  }

  async function leerCarteraCompleta() {
    if (prueba && typeof prueba !== "string") await abrirLecturas(prueba.elegidas.map((e) => e.ticker));
  }

  async function abrirLecturas(tickers: string[]) {
    if (!tickers.length || (!prueba && !previewSeleccion)) return;
    let idLectura = id;
    let pruebaId = typeof prueba === "object" ? prueba?.id : null;
    if (!idLectura || !pruebaId) {
      setOcupado(true);
      const guardada = await guardarPrueba();
      setOcupado(false);
      if (!guardada) return;
      idLectura = guardada.id;
      pruebaId = guardada.prueba.id;
      tickers = tickers.filter(t => guardada.prueba.elegidas.some(e => e.ticker === t));
    if (!tickers.length) { setError(t("builder_selection_changed_read_notice")); return; }
    }
    setModalLecturas(true);
    setTickersLecturas(tickers);
    setTickerLectura(tickers[0]);
    if (lecturaEnCurso.current) return;
    const contexto = { estrategia_id: idLectura, prueba_id: pruebaId };
    if (contextoLecturas.current !== pruebaId) setLecturas([]);
    contextoLecturas.current = pruebaId;
    lecturaEnCurso.current = true;
    setErrorLectura(null);
    setLeyendo(tickers[0]);
    try {
      const compradas = await lecturasCompradas(idLectura, pruebaId);
      if (contextoLecturas.current !== pruebaId) return;
      if (typeof compradas === "string") { setErrorLectura(compradas); return; }
      const disponibles = [...compradas];
      setLecturas(disponibles);
      for (const ticker of tickers) {
        if (disponibles.some((l) => l.ticker === ticker)) continue;
        if (contextoLecturas.current !== pruebaId) break;
        setLeyendo(ticker);
        const r = await leerAFondo(ticker, crypto.randomUUID(), contexto);
        invalidar("creditos");
        if (contextoLecturas.current !== pruebaId) break;
        if (typeof r === "string") {
          const recuperadas = await lecturasCompradas(idLectura, pruebaId);
          if (contextoLecturas.current !== pruebaId) break;
          if (typeof recuperadas !== "string") setLecturas(recuperadas);
          setErrorLectura(r);
          break;
        }
        disponibles.push(r);
        setLecturas([...disponibles]);
      }
    } catch {
      if (contextoLecturas.current === pruebaId) setErrorLectura(t("builder_read_failed_purchases_saved"));
    } finally {
      lecturaEnCurso.current = false;
      setLeyendo(null);
    }
  }

  async function cambiarEmpresa(ticker: string) {
    if (typeof prueba !== "object" || !prueba) return;
    if (!prueba.id) {
      const excluidas = [...new Set([...b!.excluidas, ticker])];
      actualizarB({ excluidas });
      if (recetaPreview) await verQueEntrarian({ ...recetaPreview, excluidas });
      return;
    }
    if (!id) return;
    setOcupado(true);
    const antes = prueba.elegidas.map((e) => e.ticker);
    const r = await excluirEmpresa(id, ticker);
    if (typeof r === "string") { setError(r); setOcupado(false); return; }
    // La exclusión vive ya en la receta del servidor: se refleja aquí para que el próximo
    // «guardar» (otra prueba, o apuntarse) no la deshaga mandando el `excluidas` local viejo.
    actualizarB({ excluidas: r.excluidas });
    const p = await probarEstrategia(id);
    if (typeof p === "string") { setError(p); setOcupado(false); return; }
    const entrante = p.elegidas.map((e) => e.ticker).find((t) => !antes.includes(t));
    setCambio(entrante ? { entra: entrante, sale: ticker } : null);
    actualizarPrueba(p);
    setOcupado(false);
  }

  async function deshacerCambio(ticker: string) {
    if (!prueba || typeof prueba !== "object" || !prueba.id) {
      const excluidas = b!.excluidas.filter(t => t !== ticker);
      actualizarB({ excluidas });
      if (recetaPreview) await verQueEntrarian({ ...recetaPreview, excluidas });
      return;
    }
    if (!id) return;
    setOcupado(true);
    const r = await quitarExclusion(id, ticker);
    if (typeof r === "string") { setError(r); setOcupado(false); return; }
    actualizarB({ excluidas: r.excluidas });
    const p = await probarEstrategia(id);
    setCambio(null);
    actualizarPrueba(p);
    setOcupado(false);
  }

  // Debounce (~200 ms) + AbortController + un número de petición: si el usuario sigue
  // escribiendo, la respuesta de la letra anterior se descarta aunque llegue tarde (H4 del
  // informe de fluidez: antes «Ap»/«App»/«Appl»/«Apple» salían las cuatro a la vez y podía
  // ganar la más vieja).
  function buscar(q: string) {
    setBuscaQ(q);
    setPorque(null);
    if (buscaTimer.current) clearTimeout(buscaTimer.current);
    buscaAbort.current?.abort();
    if (q.trim().length < 1) { setSugerencias([]); return; }
    const miPeticion = ++buscaId.current;
    buscaTimer.current = setTimeout(async () => {
      const controlador = new AbortController();
      buscaAbort.current = controlador;
      let r: EmpresaBusqueda[] | string;
      try {
        r = await buscarUniverso(q.trim(), controlador.signal);
      } catch {
        return; // cancelada a propósito: ya hay una búsqueda más nueva en marcha
      }
      if (miPeticion !== buscaId.current) return; // respuesta obsoleta, se descarta
      setSugerencias(typeof r === "string" ? [] : r);
    }, 200);
  }

  async function preguntarPorQue(emp: EmpresaBusqueda) {
    buscaId.current += 1; // descarta cualquier búsqueda en marcha: ya se ha elegido una empresa
    if (buscaTimer.current) clearTimeout(buscaTimer.current);
    buscaAbort.current?.abort();
    setSugerencias([]);
    setBuscaQ(emp.nombre ?? emp.ticker);
    if ((!id || !prueba || typeof prueba !== "object" || !prueba.id) && recetaPreview) {
      const r = await previsualizarSeleccion({ ...recetaPreview, ticker: emp.ticker });
      setPorque({ ticker: emp.ticker, nombre: emp.nombre ?? emp.ticker,
        texto: typeof r === "string" ? r : r.explicacion ?? r.mensaje });
      return;
    }
    if (!id) return;
    const r = await porQueNoSale(id, emp.ticker);
    setPorque({ ticker: emp.ticker, nombre: emp.nombre ?? emp.ticker,
      texto: typeof r === "string" ? r : r.motivo });
  }

  async function apuntarse() {
    setOcupado(true);
    const idActual = await guardar();
    if (idActual) {
      // Visibilidad, declaración y «Cada día 1» solo se guardan aquí: sin esto se quedan en pantalla.
      const cambios: EstrategiaPatch = {};
      if (visibilidad !== (estrategia?.visibilidad ?? "privada")) cambios.visibilidad = visibilidad;
      if (visibilidad === "publicada" && declaraPosiciones
          && declaraPosiciones !== estrategia?.declara_posiciones) {
        cambios.declara_posiciones = declaraPosiciones;
      }
      if (cadaDia1Opcion !== (estrategia?.cada_dia_1 ?? "revisar")) cambios.cada_dia_1 = cadaDia1Opcion;
      if (Object.keys(cambios).length > 0) {
        const guardada = await actualizarEstrategia(idActual, cambios);
        if (typeof guardada === "string") { setError(guardada); setOcupado(false); return; }
        setEstrategia(guardada);
      }
      const r = await apuntar(idActual);
      if (typeof r === "string") { setError(r); setOcupado(false); return; }
      // La lista de «Mías» ya cacheada (si el usuario vino de ahí) queda desfasada: se invalida
      // para que la próxima vez que se mire se pida entera, en vez de enseñar el estado viejo.
      invalidar("mis-estrategias");
      router.push("/mias");
      return;
    }
    setOcupado(false);
  }

  const cartera = previewDato?.valor.elegidas ?? [];
  const carteraProps = { elegidas: cartera, pasan: previewDato?.valor.cumplen_reglas ?? null,
    huecos: previewDato ? Math.max(0, b.n_empresas - cartera.length) : 0, cajaPct: previewDato?.valor.caja_pct ?? null,
    sectores: catalogo.sectores, ...movimientos };
  // La cartera ya se ve en vivo (barra de abajo y su hoja): aquí solo se avisa de lo que falla.
  const avisoPreview = previewSeleccionCargando ? null
    : previewSeleccionError ? <p className="cr-pie mal" role="alert">{previewSeleccionError}</p>
    : previewSeleccion && previewSeleccion.estado !== "disponible" && previewSeleccion.mensaje
      ? <p className="cr-pie" role="status">{previewSeleccion.mensaje}</p> : null;
  const errorGuardado = !ESTADOS_SIN_AVISO.includes(autoguardado.estado);
  const bloqueado = ocupado || convOcupado;
  // «Ver qué empresas entrarían hoy» solo hace falta para la pregunta o la lectura a fondo: la cartera ya es en vivo.
  const pruebasCartera = (PREGUNTA_VISIBLE || LECTURA_VISIBLE) ? <div className="cartera-pruebas">
    <button type="button" className="cr-boton tinte" disabled={ocupado} onClick={() => void verQueEntrarian()}>
      {ocupado ? t("builder_testing") : t("builder_preview_today")}</button>
    {PREGUNTA_VISIBLE && typeof prueba === "object" && prueba && b.pregunta && !costePregunta && <button type="button" className="cr-boton tinte" disabled={ocupado}
      onClick={async () => { setOcupado(true); try { await guardarPrueba(); } finally { setOcupado(false); } }}>
      {t("builder_save_check_question_cost")}</button>}
    {typeof prueba === "string" && <p className="cr-pie" role="status">{prueba}</p>}
    {PREGUNTA_VISIBLE && typeof prueba === "object" && prueba && b.pregunta && costePregunta && costePregunta.faltan > 0 && (
      <button type="button" className="cr-boton tinte" disabled={ocupado} onClick={probarConPregunta}>
        {ocupado ? t("builder_asking") : t("builder_test_question_cost", { count: costePregunta.creditos, companies: costePregunta.evaluadas })}</button>)}
    {typeof prueba === "object" && prueba && (prueba.sin_notas > 0 || prueba.sin_respuesta > 0) && <p className="cr-pie">
      {t("builder_partial_selection", { withoutScores: prueba.sin_notas, withoutAnswer: prueba.sin_respuesta })}</p>}
    {LECTURA_VISIBLE && typeof prueba === "object" && prueba && prueba.elegidas.length > 0 && (
      <button type="button" className="cr-boton tinte" onClick={leerCarteraCompleta}>
        {prueba.elegidas.every((e) => lecturas.some((l) => l.ticker === e.ticker)) ? t("builder_view_portfolio_reports")
          : t(prueba.id ? "builder_read_portfolio" : "builder_save_read_portfolio", { count: prueba.elegidas.length * 5 })}</button>)}
  </div> : null;

  return (
    <main className="scroll lv-pagina cr constructor">
      <CabeceraApp titulo={titulo} />
      <SegmentoLiga className="cr-etapas" etiquetaGrupo={t("builder_steps_aria")} valor={etapa} opciones={opcionesEtapas}
        onChange={i => irEtapa(i)} desactivado={bloqueado} />
      {antes}
      {errorGuardado && <div className="cr-grupo constructor-guardado" role="alert" style={{ marginTop: 12 }}>
        <div className="cr-celda"><span className="t"><b className="normal mal">{t("builder_draft_save_title")}</b>
          <small>{autoguardado.estado}</small></span>
          <button type="button" className="cr-enlace pequeno" onClick={autoguardado.reintentar}>{t("builder_retry")}</button><span /></div>
      </div>}
      <fieldset className="constructor-tarea" disabled={bloqueado}
        onFocusCapture={e => { if (e.target instanceof HTMLInputElement && e.target.type === "number") deshacer.iniciar(b); }}
        onPointerDownCapture={e => { if (e.target instanceof HTMLInputElement && e.target.type === "range") { e.target.setPointerCapture(e.pointerId); deshacer.iniciar(b); } }}
        onKeyDownCapture={e => { if (e.target instanceof HTMLInputElement && e.target.type === "range" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) deshacer.iniciar(b); }}
        onPointerUpCapture={() => deshacer.terminar(b)} onPointerCancelCapture={() => deshacer.terminar(b)}
        onKeyUpCapture={() => deshacer.terminar(b)} onBlurCapture={() => deshacer.terminar(b)}>
        <h2 ref={etapaRef} tabIndex={-1} className="cr-pregunta constructor-pregunta">{t(PREGUNTAS[etapa])}</h2>
        <div key={etapa} className="cr-fundido">
          {etapa === 0 && <PasoIdea catalogo={catalogo} mercado={mercado} idea={convFrase} reglas={b.reglas}
            estrategiaId={id} quedan={convQuedan} alCambiarQuedan={setConvQuedan}
            alCambiarOcupado={setConvOcupado} alCambiarIdea={setConvFrase}
            actualizarB={actualizarB} irReglas={() => irEtapa(1)} />}

          {etapa === 1 && <>
            <PasoReglas catalogo={catalogo} mercado={mercado} reglas={b.reglas} preview={previewSeleccion}
              estrategiaId={id} quedan={convQuedan} alCambiarQuedan={setConvQuedan}
              alCambiarOcupado={setConvOcupado} actualizarB={actualizarB} />
            {avisoPreview}
          </>}

          {etapa === 2 && <PasoCriterios catalogo={catalogo} pregunta={b.pregunta} pesos={b.pesos}
            pro={pro} actualizarB={actualizarB}>{avisoPreview}</PasoCriterios>}

          {etapa === 3 && <PasoCartera receta={recetaPreview ?? undefined} estrategiaId={id} alActualizar={alActualizarDatos}
            preview={previewSeleccion} nEmpresas={b.n_empresas} reparto={b.reparto} maxPorSector={b.max_por_sector}
            sectores={catalogo.sectores} excluidas={b.excluidas} irReglas={() => irEtapa(1)}
            cambio={cambio ?? (movimientos.entran.length === 1 && movimientos.salen.length === 1
              ? { entra: movimientos.entran[0], sale: movimientos.salen[0].ticker } : null)}
            actualizarB={actualizarB} cambiar={ticker => {
              if (typeof prueba === "object" && prueba?.id) void cambiarEmpresa(ticker);
              else actualizarB({ excluidas: [...new Set([...b.excluidas, ticker])] });
            }} recuperar={ticker => {
              if (typeof prueba === "object" && prueba?.id) void deshacerCambio(ticker);
              else actualizarB({ excluidas: b.excluidas.filter(t => t !== ticker) });
            }} leer={leerFicha} lecturas={lecturas.map(l => l.ticker)} busca={buscaQ} buscar={buscar}
            sugerencias={sugerencias} preguntar={preguntarPorQue} porque={porque}
            cadaDia1={cadaDia1Opcion} cambiarCadaDia1={setCadaDia1Opcion}>
            {avisoPreview}{pruebasCartera}
          </PasoCartera>}

          {etapa === 4 && <PasoRevisar preview={previewSeleccion}
            nombre={nombre} cambiarNombre={v => { setNombre(v); if (v.trim()) setErrorNombre(false); }}
            nombreRef={nombreRef} errorNombre={errorNombre}
            escudo={cr} cambiarEscudo={setCr}
            visibilidad={visibilidad} cambiarVisibilidad={v => { setVisibilidad(v); if (v === "privada") setDeclaraPosiciones(null); }}
            declara={declaraPosiciones} cambiarDeclara={setDeclaraPosiciones}
            faltanReglas={faltanReglas} pro={pro} />}
        </div>
        {error && <p className="cr-pie mal" role="alert">{error}</p>}
      </fieldset>

      <div className="cr-dock constructor-avanzar" role="group" aria-label={t("builder_dock_aria")}>
        <button type="button" className="cr-dock-cartera constructor-ver-cartera" aria-haspopup="dialog" aria-expanded={hojaAbierta}
          onClick={() => setHojaAbierta(true)}>
          <small>{t("builder_live_title")}</small>
          <b className="num">{t("builder_dock_empresas", { count: cartera.length })}{" "}
            <span>{t("builder_dock_de", { total: carteraProps.pasan === null ? "–" : miles(carteraProps.pasan, locale) })}</span></b>
        </button>
        {etapa > 0 ? <button type="button" className="cr-dock-atras" disabled={bloqueado}
          aria-label={t("builder_previous_step", { step: t(ETAPAS[etapa - 1]) })} onClick={() => irEtapa(etapa - 1)}><IconoAtras /></button> : <span />}
        {etapa < 4
          ? <button type="button" className="cr-boton" disabled={bloqueado} onClick={() => irEtapa(etapa + 1)}>{t("builder_live_continue")}</button>
          : <button type="button" className="cr-boton" disabled={bloqueado || !puedeApuntarse} onClick={apuntarse}>
            {ocupado ? t("builder_saving") : t("builder_save_signup")}</button>}
      </div>
      {avisoCartera && <AvisoCrear texto={avisoCartera} etiquetaDeshacer={t("builder_undo")} onFin={cerrarAviso}
        onDeshacer={() => { const copia = deshacer.recuperar(); if (copia) actualizarB(copia, false); setAvisoCartera(null); }} />}
      <CarteraHoja abierta={hojaAbierta} onCerrar={cerrarHoja}><CarteraViva {...carteraProps} />
        {ACTUALIZACION_VISIBLE && usarFrescas && <p className="cr-pie">{t("builder_actualizar_hecha")}</p>}</CarteraHoja>
      <BarraPestanas />
      {LECTURA_VISIBLE && <LecturasModal abierto={modalLecturas} tickers={tickersLecturas} activo={tickerLectura}
        lecturas={lecturas} leyendo={leyendo} error={errorLectura}
        onSeleccionar={setTickerLectura} onCerrar={() => setModalLecturas(false)} />}
    </main>
  );
}
