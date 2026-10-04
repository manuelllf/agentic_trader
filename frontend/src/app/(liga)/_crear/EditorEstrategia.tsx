"use client";

// La selección puede probarse sin crear estrategia; guardar o inscribir requiere identidad.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import { InfoTip } from "@/components/InfoTip";
import {
  BarraPestanas, Boton, Cargando, Escudo, ErrorLiga, OpcionRadio, Segmentado,
  escudoAleatorio, luminancia, PALETA, type EscudoValor,
} from "../_ui";
import {
  actualizarEstrategia, apuntar, buscarUniverso, convertirFrase, costeProbarConPregunta,
  crearEstrategia, crearReceta, excluirEmpresa, getCatalogo, getFicha,
  leerAFondo, lecturasCompradas, porQueNoSale, probarEstrategia, quitarExclusion, verEstrategia,
  leerBorrador, vincularBorrador, type ContenidoBorrador,
  type Catalogo, type CostePregunta, type EmpresaBusqueda, type Estrategia, type EstrategiaPatch,
  previsualizarSeleccion, type InterpretacionIdea, type Lectura, type Prueba, type PreviewSeleccion,
  type RecetaEntrada, type ReglaElegida,
} from "@/lib/liga/api";
import { invalidar, obtener } from "@/lib/liga/cache";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { miles } from "@/lib/liga/format";
import { pesosCoherentes } from "@/lib/liga/receta";
import { LecturasModal } from "./LecturasModal";
import { useAutoguardado } from "./useAutoguardado";
import "./constructor.css";
const RUTA_ACTUAL = (id?: string) => (id ? `/crear/${id}` : "/crear");
const ETAPAS = ["builder_step_idea", "builder_step_rules", "builder_step_criteria", "builder_step_portfolio", "builder_step_review"];
const PREGUNTAS = ["builder_question_idea", "builder_question_rules", "builder_question_criteria", "builder_question_portfolio", "builder_question_review"];
type PruebaVista = Omit<Prueba, "id" | "foto_id" | "scan_run_id"> & { id: string | null; foto_id: number | null; scan_run_id: number | null };
const VALORACIONES: Record<string, { titulo: string; ayuda: string }> = {
  negocio: { titulo: "builder_fundamentals", ayuda: "builder_fundamentals_help" },
  precio: { titulo: "builder_valuation", ayuda: "builder_valuation_help" },
  deuda: { titulo: "builder_financial_strength", ayuda: "builder_financial_strength_help" },
  pronto: { titulo: "builder_near_term_catalyst", ayuda: "builder_near_term_catalyst_help" },
};

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
    max_por_sector: 2,
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

const ETIQUETA_REPARTO: Record<string, string> = {
  igual: "builder_equal_weights", nota: "builder_score_weights",
};
const ETIQUETA_SECTOR_LIMITE = (n: number, t: (key: string, values?: Record<string, number>) => string) =>
  n === 0 ? t("builder_no_limit") : t("builder_per_sector", { count: n });

export function EditorEstrategia({ estrategiaIdInicial }: { estrategiaIdInicial?: string }) {
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

  const [nombre, setNombre] = useState("");
  const [cr, setCr] = useState<EscudoValor>(() => escudoAleatorio());
  const [b, setB] = useState<Borrador | null>(null);
  const [visibilidad, setVisibilidad] = useState<"privada" | "publicada">("privada");
  const [declaraPosiciones, setDeclaraPosiciones] = useState<"si" | "no" | null>(null);
  const [cadaDia1Opcion, setCadaDia1Opcion] = useState<"revisar" | "mantener">("revisar");
  const [etapa, setEtapa] = useState(0);
  const [revisionInicial, setRevisionInicial] = useState<number | null>(null);
  const etapaRef = useRef<HTMLHeadingElement>(null);
  const pasosRef = useRef<HTMLElement>(null);

  const [editorEscudoAbierto, setEditorEscudoAbierto] = useState(false);
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
  const [convError, setConvError] = useState<string | null>(null);
  const [convUsos, setConvUsos] = useState<{ hoy: number; tope: number } | null>(null);
  const [convAviso, setConvAviso] = useState<string | null>(null);
  const [filtroFrase, setFiltroFrase] = useState("");
  const [busquedaFiltros, setBusquedaFiltros] = useState("");
  const [filtroSugerido, setFiltroSugerido] = useState<{ reglas: ReglaElegida[]; interpretacion: InterpretacionIdea[] } | null>(null);
  const [filtroError, setFiltroError] = useState<string | null>(null);
  const recetaPreview = useMemo((): RecetaEntrada | null => {
    if (!b) return null;
    const { pregunta, pesos } = pesosCoherentes(yo?.plan === "pro" ? b.pregunta : "", b.pesos);
    return { idea: convFrase || null, reglas: b.reglas, excluidas: b.excluidas, pregunta, pesos,
      n_empresas: b.n_empresas, reparto: b.reparto, max_por_sector: b.max_por_sector };
  }, [b, convFrase, yo?.plan]);
  const clavePreview = JSON.stringify(recetaPreview);
  const previewSeleccion = previewDato?.clave === clavePreview ? previewDato.valor : null;

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
  }, [clavePreview, estado]);

  // Catálogo (caché compartida con la portada y `crear/[id]`, ver H3 del informe de fluidez) +
  // (si se edita) la estrategia y su receta vigente.
  useEffect(() => {
    if (!sesionLista || estado !== "dentro") return;
    let vivo = true;
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
  // Los porcentajes son la parte de cada peso sobre los que se ven: sin pregunta, no cuenta.
  const totalPesos = useMemo(
    () => (b ? Object.entries(b.pesos)
      .reduce((a, [k, v]) => a + (k === "pregunta" && !b.pregunta.trim() ? 0 : v), 0) || 1 : 1),
    [b],
  );

  if (!sesionLista || cargandoInicial) {
    return (
      <main className="scroll constructor" aria-busy="true">
        <h1 className="h1 constructor-titulo">{estrategiaIdInicial ? t("builder_edit_title") : t("builder_new_title")}</h1>
        <nav className="constructor-etapas" aria-label={t("builder_steps_aria")}>
          {ETAPAS.map((titulo, i) => <button key={titulo} type="button" disabled aria-current={etapa === i ? "step" : undefined}>{t(titulo)}</button>)}
        </nav>
        <div style={{ marginTop: 12 }}><Cargando filas={3} /></div>
        <BarraPestanas />
      </main>
    );
  }
  if (typeof catalogo === "string") {
    return (
      <main className="scroll">
        <ErrorLiga titulo={t("builder_catalog_error")} mensaje={catalogo}
                   accion={{ texto: t("builder_retry"), onClick: () => window.location.reload() }} />
      </main>
    );
  }
  if (errorCarga) {
    return (
      <main className="scroll">
        <ErrorLiga titulo={t("builder_open_error")} mensaje={errorCarga}
                   accion={{ texto: t("builder_back_to_mine"), onClick: () => router.push("/mias") }} />
      </main>
    );
  }
  if (!catalogo || !b) return null;

  const reglasDisponibles = catalogo.reglas.filter((r) => !b.reglas.some((x) => x.clave === r.clave));
  const puedeApuntarse = !(visibilidad === "publicada" && !declaraPosiciones);

  function irEtapa(siguiente: number) {
    setEtapa(siguiente);
    const url = new URL(window.location.href);
    url.searchParams.set("etapa", String(siguiente));
    window.history.pushState(null, "", url);
    void autoguardado.guardar();
  }

  function actualizarB(cambios: Partial<Borrador>) {
    setB((prev) => (prev ? { ...prev, ...cambios } : prev));
    actualizarPrueba(null);
    setCambio(null);
    contextoLecturas.current = null;
    setLecturas([]);
    setModalLecturas(false);
  }

  function anadirRegla(clave: string) {
    const regla = (catalogo as Catalogo).reglas.find((r) => r.clave === clave);
    if (!regla) return;
    const params: Record<string, unknown> = {};
    for (const p of regla.parametros) {
      if (p.tipo === "sectores") params[p.nombre] = [];
      else if (p.defecto != null) params[p.nombre] = p.defecto;
    }
    actualizarB({ reglas: [...b!.reglas, { clave, params }] });
  }

  function quitarRegla(clave: string) {
    actualizarB({ reglas: b!.reglas.filter((r) => r.clave !== clave) });
  }

  function cambiarParametro(clave: string, nombreParam: string, valor: unknown) {
    actualizarB({
      reglas: b!.reglas.map((r) => (r.clave === clave
        ? { ...r, params: { ...r.params, [nombreParam]: valor } } : r)),
    });
  }

  function alternarSector(clave: string, nombreParam: string, sector: string) {
    const regla = b!.reglas.find((r) => r.clave === clave);
    const actuales = (regla?.params[nombreParam] as string[] | undefined) ?? [];
    const nuevos = actuales.includes(sector)
      ? actuales.filter((s) => s !== sector) : [...actuales, sector];
    cambiarParametro(clave, nombreParam, nuevos);
  }

  /** Crea la estrategia si hace falta, guarda una versión de la receta y devuelve su id. */
  async function guardar(): Promise<string | null> {
    if (!(await autoguardado.guardar())) { setError(t("builder_draft_save_error")); return null; }
    if (!nombre.trim()) {
      setError(t("builder_name_required"));
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
    const { pregunta, pesos } = pesosCoherentes(pro ? b!.pregunta : "", b!.pesos);
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
    if (b?.pregunta && pro) {
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
    if (!prueba || typeof prueba === "string" || !tickers.length) return;
    let idLectura = id;
    let pruebaId = prueba.id;
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

  async function sugerirFiltro() {
    if (!filtroFrase.trim()) return;
    setConvOcupado(true); setFiltroError(null); setFiltroSugerido(null);
    try {
      const r = await convertirFrase(filtroFrase.trim());
      if (typeof r === "string") { setFiltroError(r); return; }
      setConvUsos({ hoy: r.usos_hoy, tope: r.usos_tope });
      setFiltroSugerido({ reglas: r.reglas, interpretacion: r.interpretacion ?? [] });
    } finally { setConvOcupado(false); }
  }

  async function usarConversor() {
    if (!convFrase.trim()) return;
    setConvOcupado(true);
    setConvError(null);
    const r = await convertirFrase(convFrase.trim());
    setConvOcupado(false);
    if (typeof r === "string") { setConvError(r); return; }
    setConvUsos({ hoy: r.usos_hoy, tope: r.usos_tope });
    // La sugerencia se guarda como borrador; el usuario revisa las reglas antes de ejecutarlas.
    const clavesConocidas = new Set((catalogo as Catalogo).reglas.map((c) => c.clave));
    const reglasNuevas = r.reglas.filter(
      (nueva) => clavesConocidas.has(nueva.clave) && !b!.reglas.some((x) => x.clave === nueva.clave),
    );
    const pregunta = pro && r.pregunta ? r.pregunta : b!.pregunta;
    actualizarB({
      reglas: [...b!.reglas, ...reglasNuevas],
      interpretacion: r.interpretacion ?? [],
      pesos: pesosCoherentes(pregunta, r.pesos ? { ...b!.pesos, ...r.pesos } : b!.pesos).pesos,
      pregunta,
    });
    if (r.nombre && !nombre.trim()) setNombre(r.nombre);
    setConvAviso(t("builder_interpretation_review_notice"));
    setEtapa(1);
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

  // «Tu pregunta» solo pesa si hay pregunta escrita.
  const wkeys = catalogo.pesos.claves.filter((k) => k !== "pregunta" || (pro && b.pregunta.trim()));
  const cifraPreview = (valor: number | null | undefined) =>
    valor == null ? "—" : new Intl.NumberFormat(locale).format(valor);
  const feedbackPreview = (
    <details className="preview-resumen">
      <summary>{previewSeleccionCargando ? t("builder_preview_updating")
        : previewSeleccion ? t("builder_preview_result", { passed: cifraPreview(previewSeleccion.cumplen_reglas), selected: cifraPreview(previewSeleccion.seleccionadas), incomplete: previewSeleccion.estado === "incompleto" ? t("builder_missing_scores") : "" })
          : previewSeleccionError ? t("builder_preview_unavailable") : t("builder_preview_saved")}</summary>
      {!previewSeleccionCargando && previewSeleccionError &&
        <p>{previewSeleccionError} {t("builder_preview_no_change")}</p>}
      {!previewSeleccionCargando && !previewSeleccionError && previewSeleccion?.estado === "sin_datos" &&
        <p>{previewSeleccion.mensaje} {t("builder_candidates_not_counted")}</p>}
      {!previewSeleccionCargando && !previewSeleccionError && previewSeleccion && previewSeleccion.estado !== "sin_datos" && (
        <>
          <p>
            {previewSeleccion.mensaje} {t("builder_preview_counts", { evaluated: cifraPreview(previewSeleccion.evaluadas), passed: cifraPreview(previewSeleccion.cumplen_reglas), ranked: cifraPreview(previewSeleccion.candidatas_ordenadas), selected: cifraPreview(previewSeleccion.seleccionadas) })}
            {previewSeleccion.caja_pct != null && previewSeleccion.caja_pct > 0.01 && ` ${t("builder_preview_cash", { percent: Math.round(previewSeleccion.caja_pct) })}`}
          </p>
          {previewSeleccion.elegidas.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
              {previewSeleccion.elegidas.map((e) => (
                <li key={e.ticker}>{e.nombre ?? e.ticker} ({e.ticker}) · {new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(e.peso))} %</li>
              ))}
            </ul>
          )}
        </>
      )}
      {!previewSeleccionCargando && !previewSeleccionError && !previewSeleccion &&
        <p>{t("builder_counts_saved_snapshot")}</p>}
    </details>
  );

  return (
    <main className="scroll constructor">
      <h1 className="h1 constructor-titulo">{estrategiaIdInicial ? t("builder_edit_title") : t("builder_new_title")}</h1>
      <nav ref={pasosRef} className="constructor-etapas" aria-label={t("builder_steps_aria")}>
        {ETAPAS.map((titulo, i) => <button key={titulo} type="button" aria-current={etapa === i ? "step" : undefined}
          disabled={ocupado || convOcupado} onClick={() => void irEtapa(i)}>{t(titulo)}</button>)}
      </nav>
      <p className="constructor-guardado" role="status">{autoguardado.estado === "Guardado" ? t("builder_autosave_saved") : autoguardado.estado === "Guardando…" ? t("builder_autosave_saving") : autoguardado.estado === "Cambios pendientes" ? t("builder_autosave_pending") : autoguardado.estado}
        {!["Guardado", "Guardando…", "Cambios pendientes"].includes(autoguardado.estado)
          && <button type="button" className="link" onClick={autoguardado.reintentar}>{t("builder_retry")}</button>}
      </p>
      <div className="constructor-distribucion">
      <fieldset className="constructor-tarea" disabled={ocupado || convOcupado}>
      <h2 ref={etapaRef} tabIndex={-1} className="constructor-pregunta">{t(PREGUNTAS[etapa])}</h2>
      <div className="field constructor-reglas" hidden={etapa !== 1}>
        <div className="more filtro-asistente lenguaje-natural">
          <label className="lbl" htmlFor="filtroFrase">{t("builder_add_filter_natural")}<small>{t("builder_ai_proposes_catalog_filters")}</small></label>
          <textarea id="filtroFrase" className="inp" rows={2} maxLength={300} value={filtroFrase}
            placeholder={t("builder_filter_example")}
            onChange={e => { setFiltroFrase(e.target.value); setFiltroSugerido(null); }} />
          <Boton variante="principal" disabled={convOcupado || !filtroFrase.trim()} onClick={sugerirFiltro}>
            {convOcupado ? t("builder_searching_rules") : t("builder_propose_rules")}
          </Boton>
          <p className="fine">{t("builder_idea_sent_notice")}</p>
          {filtroError && <p className="fine" role="alert">{filtroError}</p>}
          {filtroSugerido && <div className="review">
            {filtroSugerido.interpretacion.map((i, n) => <p className="fine" key={n}><b>{t(i.tipo === "exacta" ? "builder_exact" : i.tipo === "aproximada" ? "builder_approximate" : "builder_unavailable")}:</b> {i.intencion}. {i.motivo}</p>)}
            {filtroSugerido.reglas.filter(r => !b.reglas.some(e => e.clave === r.clave) && catalogo.reglas.some(c => c.clave === r.clave)).map(r =>
              <Boton key={r.clave} variante="secundario" onClick={() => actualizarB({ reglas: [...b.reglas, r], interpretacion: [...b.interpretacion, ...filtroSugerido.interpretacion.filter(i => i.regla === r.clave)] })}>
                {t("builder_add_rule", { title: catalogo.reglas.find(c => c.clave === r.clave)?.titulo ?? r.clave })}
              </Boton>)}
          </div>}
        </div>
        {b.interpretacion.length > 0 && (
          <section aria-label={t("builder_idea_interpretation")} className="review" style={{ marginBottom: 16 }}>
            <b>{t("builder_idea_interpretation")}</b>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              {b.interpretacion.map((item, i) => {
                const regla = item.regla
                  ? catalogo.reglas.find((r) => r.clave === item.regla)?.titulo ?? item.regla
                  : null;
                const incluida = item.regla && b.reglas.some((r) => r.clave === item.regla);
                const estado = item.tipo === "exacta" ? t("builder_exact")
                  : item.tipo === "aproximada" ? t("builder_approximate") : t("builder_no_rule_available");
                return (
                  <li key={`${item.intencion}-${i}`} style={{ marginTop: 8 }}>
                    <b>{estado}:</b> {item.intencion}
                    {regla && <span> · {regla}{!incluida && ` (${t("builder_removed_from_list")})`}</span>}
                    <p className="fine" style={{ margin: "2px 0 0" }}>{item.motivo}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <span className="lbl reglas-titulo">
          {t("builder_your_filters")}
          <small>{t("builder_exact_filters_help")}</small>
        </span>
        {b.reglas.length > 0 && (
          <div className="rules">
            {b.reglas.map((r) => {
              const def = catalogo!.reglas.find((c) => c.clave === r.clave);
              if (!def) return null;
              return (
                <div key={r.clave} className="rulec" style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <b>{def.titulo}</b>
                    <button type="button" onClick={() => quitarRegla(r.clave)}
                            aria-label={t("builder_remove_rule", { title: def.titulo })}>×</button>
                  </div>
                  {def.parametros.length > 0 && (
                    <div className="rule-params">
                      {def.parametros.map((p) => p.tipo === "sectores" ? (
                        <div key={p.nombre}>
                          <span style={{ fontSize: 13.5, color: "var(--muted)" }}>{p.etiqueta}</span>
                          <div className="rule-sectores">
                            {Object.entries(catalogo!.sectores).map(([clave, etiqueta]) => (
                              <button key={clave} type="button"
                                      aria-pressed={((r.params[p.nombre] as string[] | undefined) ?? []).includes(clave)}
                                      onClick={() => alternarSector(r.clave, p.nombre, clave)}>
                                {etiqueta}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="rng" key={p.nombre}>
                          <label htmlFor={`p-${r.clave}-${p.nombre}`}>{p.etiqueta}</label>
                          <output>{String(r.params[p.nombre] ?? p.defecto ?? "")}</output>
                          <input id={`p-${r.clave}-${p.nombre}`} type="range"
                                 min={p.minimo ?? 0} max={p.maximo ?? 100} step={p.paso ?? 1}
                                 value={Number(r.params[p.nombre] ?? p.defecto ?? p.minimo ?? 0)}
                                 onChange={(e) => cambiarParametro(r.clave, p.nombre, Number(e.target.value))} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {reglasDisponibles.length > 0 && (
          <div className="filtros-catalogo">
            <label className="lbl" htmlFor="buscarFiltro">{t("builder_add_filters")}</label>
            <input id="buscarFiltro" type="search" className="inp" placeholder={t("builder_search_catalog")}
              value={busquedaFiltros} onChange={e => setBusquedaFiltros(e.target.value)} />
            <div className="starters">
            {reglasDisponibles.filter(r => r.titulo.toLocaleLowerCase(locale).includes(busquedaFiltros.trim().toLocaleLowerCase(locale))).map((r) => (
              <button key={r.clave} type="button" className="starter" onClick={() => anadirRegla(r.clave)}>
                <span aria-hidden="true">+</span> {r.titulo}
              </button>
            ))}
            </div>
            {!reglasDisponibles.some(r => r.titulo.toLocaleLowerCase(locale).includes(busquedaFiltros.trim().toLocaleLowerCase(locale))) && <p className="fine" role="status">{t("builder_no_matching_filters")}</p>}
          </div>
        )}
        {b.reglas.length === 0 && (
          <p className="fine" style={{ marginTop: 0 }}>{t("builder_no_rules_all_pass")}</p>
        )}
        {feedbackPreview}
      </div>

      <div className="field lenguaje-natural" hidden={etapa !== 0}>
        <label className="lbl" htmlFor="convFrase">
          {t("builder_describe_strategy")}
          <small>
            {t("builder_describe_help")}
            {convUsos && ` ${t("builder_uses_remaining", { count: Math.max(0, convUsos.tope - convUsos.hoy) })}`}
          </small>
        </label>
        <textarea id="convFrase" className="inp" maxLength={300} rows={2}
                  placeholder={t("builder_idea_example")}
                  value={convFrase} onChange={(e) => {
                    const idea = e.target.value;
                    setConvFrase(idea);
                    setConvAviso(null);
                    setB((prev) => prev && prev.interpretacion.length > 0
                      ? { ...prev, interpretacion: [] } : prev);
                  }} />
        <div style={{ marginTop: 8 }}>
          <Boton variante="principal" disabled={convOcupado || !convFrase.trim()}
                 onClick={usarConversor}>
            {convOcupado ? t("builder_interpreting") : t("builder_interpret_strategy")}
          </Boton>
        </div>
        <p className="fine">{t("builder_convert_idea_notice")}</p>
        {convError && <p className="fine" style={{ color: "var(--danger, #e66767)" }}>{convError}</p>}
        <p className="fine">{t("builder_continue_manual")}</p>
      </div>

      {convAviso && etapa === 1 && <p className="aviso" role="status">{convAviso}</p>}
      <div className="field pregunta-propia lenguaje-natural" hidden={etapa !== 2}>
        <label className="lbl" htmlFor="cQ">
          {t("builder_question_pro")}
          <small>
            {pro
              ? t("builder_question_help_pro")
              : t("builder_question_help")}
          </small>
        </label>
        {pro ? (
          <textarea id="cQ" className="inp" maxLength={160}
                    placeholder={t("builder_question_placeholder")}
                    value={b.pregunta}
                    onChange={(e) => actualizarB({
                      pregunta: e.target.value,
                      pesos: pesosCoherentes(e.target.value, b.pesos).pesos,
                    })} />
        ) : (
          <div className="lock">
            {t("builder_question_requires_pro")}
            <div><Boton variante="principal" disabled>{t("builder_upgrade_price")}</Boton></div>
          </div>
        )}
        {pro && (
          <p className="fine">
            {t("builder_question_privacy_notice")}{" "}
            <a href="/como-funciona" target="_blank" rel="noopener noreferrer">{t("builder_how_question_used")}</a>
          </p>
        )}
      </div>

      <div className="field" hidden={etapa !== 2}>
        <span className="lbl">{t("builder_criteria")}<small>{t("builder_criteria_help")}</small></span>
        <p className="fine">{t("builder_weight_zero_help")}</p>
        {wkeys.map((k) => (
          <div className="wrow" key={k}>
          <label htmlFor={`w-${k}`}>{VALORACIONES[k] ? t(VALORACIONES[k].titulo) : catalogo!.pesos.etiquetas[k]}{VALORACIONES[k] && <InfoTip text={t(VALORACIONES[k].ayuda)} />}</label>
            <span className="num">{Math.round((b.pesos[k] * 100) / totalPesos)}&nbsp;%</span>
            <input id={`w-${k}`} type="range" min={0} max={catalogo!.pesos.maximo} step={catalogo!.pesos.paso}
                   value={b.pesos[k]} style={{ gridColumn: "1 / -1" }}
                   onChange={(e) => actualizarB({ pesos: { ...b.pesos, [k]: Number(e.target.value) } })} />
          </div>
        ))}
        {feedbackPreview}
      </div>

      <div className="field" hidden={etapa !== 3}>
        <span className="lbl">{t("builder_how_many_companies")}</span>
        <Segmentado etiquetaGrupo={t("builder_company_count")}
                    opciones={catalogo.n_empresas.map((n) => ({ valor: n, etiqueta: String(n) }))}
                    valor={b.n_empresas} onChange={(n) => actualizarB({ n_empresas: n })} />
        <div style={{ marginTop: 8 }}>
          <Segmentado etiquetaGrupo={t("builder_allocation")}
                      opciones={catalogo.repartos.map((r) => ({ valor: r, etiqueta: t(ETIQUETA_REPARTO[r] ?? r) }))}
                      valor={b.reparto} onChange={(r) => actualizarB({ reparto: r })} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Segmentado etiquetaGrupo={t("builder_max_per_sector")}
                      opciones={[0, 1, 2].map((n) => ({ valor: n, etiqueta: ETIQUETA_SECTOR_LIMITE(n, t) }))}
                      valor={b.max_por_sector} onChange={(n) => actualizarB({ max_por_sector: n })} />
        </div>
        <p className="sub-lbl">{t("builder_every_first_day")}</p>
        <div role="radiogroup" aria-label={t("builder_every_first_day")}>
          <OpcionRadio marcada={cadaDia1Opcion === "revisar"} titulo={t("builder_review_strategy")}
                       ayuda={t("builder_review_strategy_help")}
                       onClick={() => setCadaDia1Opcion("revisar")} />
          <OpcionRadio marcada={cadaDia1Opcion === "mantener"} titulo={t("builder_keep_strategy")}
                       ayuda={t("builder_keep_strategy_help")}
                       onClick={() => setCadaDia1Opcion("mantener")} />
        </div>
        {feedbackPreview}
      </div>

      <div className="field" hidden={etapa !== 4}>
        <span className="lbl">{t("builder_method_before_confirming")}</span>
        {convFrase && <p className="fine">{convFrase}</p>}
        <p className="fine">{t("builder_rules_and_weights", { count: b.reglas.length, weights: wkeys.filter(k => b.pesos[k] > 0).map(k =>
          `${VALORACIONES[k] ? t(VALORACIONES[k].titulo) : catalogo.pesos.etiquetas[k]} ${Math.round(b.pesos[k] * 100 / totalPesos)} %`).join(" · ") })}</p>
        <details className="more">
          <summary>{t("builder_view_chosen_conditions")}</summary>
          {b.reglas.length ? b.reglas.map(r => {
            const regla = catalogo.reglas.find(c => c.clave === r.clave);
            return <p className="fine" key={r.clave}><b>{regla?.titulo ?? r.clave}</b>{regla?.parametros.map(p => {
              const valor = r.params[p.nombre] ?? p.defecto;
              const texto = Array.isArray(valor) ? valor.map(v => catalogo.sectores[String(v)] ?? String(v)).join(", ") : String(valor ?? t("builder_no_value"));
              return ` · ${p.etiqueta}: ${texto}`;
            }).join("")}</p>;
          }) : <p className="fine">{t("builder_no_additional_universe_filters")}</p>}
        </details>
      </div>
      <div className="field" hidden={etapa !== 4}>
        <span className="lbl">{t("builder_how_portfolio_formed")}</span>
        <div className="recipe">
          <b>{previewSeleccion ? cifraPreview(previewSeleccion.evaluadas)
            : prueba && typeof prueba !== "string" ? miles(prueba.evaluadas, locale) : t("builder_pending")}</b><span>{t("builder_companies_in_snapshot")}</span>
          <b>{previewSeleccion ? cifraPreview(previewSeleccion.cumplen_reglas)
            : typeof prueba === "object" && prueba ? miles(prueba.pasan, locale) : t("builder_pending")}</b>
          <span>{t("builder_pass_rules")}</span>
          <b>{previewSeleccion?.seleccionadas != null ? cifraPreview(previewSeleccion.seleccionadas) : t("builder_up_to", { count: b.n_empresas })}</b>
          <span>{t(previewSeleccion?.seleccionadas != null ? "builder_form_portfolio" : "builder_companies_max")}: {t("builder_best_scores")}{b.max_por_sector === 0 ? "" : `, ${t("builder_sector_max", { count: b.max_por_sector })}`}</span>
          <b>{b.reparto === "igual" ? `${Math.round(100 / b.n_empresas)} %` : "+"}</b>
          <span>{t(b.reparto === "igual" ? "builder_for_each" : "builder_weight_best_scores")}</span>
        </div>
        {feedbackPreview}
        <p className="recipe-note">
          {t(cadaDia1Opcion === "revisar" ? "builder_review_at_round_start" : "builder_keep_until_change")} {t("builder_preview_no_change")}
        </p>
        <Boton variante="secundario" ancho="completo" style={{ marginTop: 14 }}
               disabled={ocupado} onClick={() => void verQueEntrarian()}>
          {ocupado ? t("builder_testing") : t("builder_preview_today")}
        </Boton>
        {b.excluidas.length > 0 && <details className="more"><summary>{t("builder_manual_exclusions", { count: b.excluidas.length })}</summary>
          {b.excluidas.map((ticker) => <Boton key={ticker} tamano="pequeno" disabled={ocupado} onClick={() => void deshacerCambio(ticker)}>{t("builder_restore_ticker", { ticker })}</Boton>)}
        </details>}
        {typeof prueba === "object" && prueba && b.pregunta && pro && !costePregunta && <Boton variante="secundario" disabled={ocupado}
          onClick={async () => { setOcupado(true); try { await guardarPrueba(); } finally { setOcupado(false); } }}>
          {t("builder_save_check_question_cost")}
        </Boton>}
        {typeof prueba === "string" && (
          <p className="fine" style={{ textAlign: "center" }} role="status">{prueba}</p>
        )}
        {typeof prueba === "object" && prueba && b?.pregunta && pro && costePregunta && costePregunta.faltan > 0 && (
          <Boton variante="secundario" ancho="completo" style={{ marginTop: 8 }}
                 disabled={ocupado} onClick={probarConPregunta}>
            {ocupado ? t("builder_asking") : t("builder_test_question_cost", { count: costePregunta.creditos })}
          </Boton>
        )}
        {typeof prueba === "object" && prueba && (
          <div style={{ marginTop: 14 }}>
            {(prueba.sin_notas > 0 || prueba.sin_respuesta > 0) && <p className="fine">
              {t("builder_partial_selection", { withoutScores: prueba.sin_notas, withoutAnswer: prueba.sin_respuesta })}
            </p>}
            <p className="meta">
              {t("builder_selection_counts", { evaluated: miles(prueba.evaluadas, locale), passed: miles(prueba.pasan, locale), selected: prueba.elegidas.length })}
            </p>
            {prueba.elegidas.map((e) => {
              const esCambio = cambio?.entra === e.ticker ? cambio : null;
              return (
                <div className="pick" key={e.ticker}>
                  <div>
                    <b>{e.nombre ?? e.ticker}</b>
                    <span>{e.ticker} · {e.sector ?? t("builder_no_sector")}</span>
                    <small>
                        {esCambio && <span className="new">{t("builder_replaces_ticker", { ticker: esCambio.sale })} </span>}
                      {e.porque}
                    </small>
                    <div className="links">
                      {esCambio && (
                        <button type="button" className="link" onClick={() => deshacerCambio(esCambio.sale)}>
                          {t("builder_undo")}
                        </button>
                      )}
                      <button type="button" className="link"
                              onClick={() => leerFicha(e.ticker)}>
                        {lecturas.some((l) => l.ticker === e.ticker) ? t("builder_view_report") : t(prueba.id ? "builder_read_deep" : "builder_save_read_deep")}
                      </button>
                    </div>
                  </div>
                  <div className="pick-r">
                    <span className="num">{Math.round(e.peso)}&nbsp;%</span>
                    <button type="button" onClick={() => cambiarEmpresa(e.ticker)} disabled={ocupado}>
                      {t("builder_change_company")}
                    </button>
                  </div>
                </div>
              );
            })}
            {prueba.caja_pct > 0.5 && (
              <p className="fine">
                {t("builder_cash_remaining", { selected: prueba.elegidas.length, percent: Math.round(prueba.caja_pct) })}
              </p>
            )}
            {prueba.elegidas.length > 0 && (
              <Boton variante="secundario" ancho="completo" style={{ marginTop: 8 }}
                     onClick={leerCarteraCompleta}>
                {prueba.elegidas.every((e) => lecturas.some((l) => l.ticker === e.ticker)) ? t("builder_view_portfolio_reports")
                  : t(prueba.id ? "builder_read_portfolio" : "builder_save_read_portfolio", { count: prueba.elegidas.length * 5 })}
              </Boton>
            )}
          </div>
        )}

        <div className="field">
            <label className="lbl" htmlFor="qSearch">
            {t("builder_why_not_selected")}<small>{t("builder_search_company_reason")}</small>
          </label>
          <input id="qSearch" className="inp" autoComplete="off" placeholder={t("builder_company_search_example")}
                 value={buscaQ} onChange={(e) => buscar(e.target.value)} />
          {sugerencias.length > 0 && (
            <div className="sugg">
              {sugerencias.map((s) => (
                <button key={s.ticker} type="button" onClick={() => preguntarPorQue(s)}>
                  {s.nombre ?? s.ticker} <span style={{ color: "var(--muted)" }}>{s.ticker}</span>
                </button>
              ))}
            </div>
          )}
          {porque && <p className="why">{porque.nombre}: {porque.texto}</p>}
          <p className="fine"><a href="/como-funciona" target="_blank" rel="noopener noreferrer">{t("builder_how_companies_selected")}</a></p>
        </div>
      </div>

      <div className="field" hidden={etapa !== 4}>
        <label className="lbl" htmlFor="cName">
          {t("builder_name_identity")}<small>{t("builder_name_identity_help")}</small>
        </label>
        <input ref={nombreRef} id="cName" className="inp" value={nombre} maxLength={28}
               autoComplete="off" placeholder={t("builder_name_placeholder")} onChange={(e) => setNombre(e.target.value)} />
        <div className="crest-ed">
          <button type="button" className="crest-btn" aria-label={t("builder_edit_crest")}
                  onClick={() => setEditorEscudoAbierto((v) => !v)}>
            <Escudo valor={cr} etiqueta={t("builder_crest_preview")} tamano={72} />
          </button>
          <div className="crest-acts">
            <Boton tamano="pequeno" onClick={() => setEditorEscudoAbierto((v) => !v)}>
              {editorEscudoAbierto ? t("builder_close_editor") : t("builder_edit_crest")}
            </Boton>
            <Boton tamano="pequeno" onClick={() => setCr(escudoAleatorio())}>{t("builder_random_crest")}</Boton>
          </div>
        </div>
        {editorEscudoAbierto && (
          <EditorEscudo valor={cr} onChange={setCr} />
        )}
      </div>

      <details className="review" hidden={etapa !== 4}>
        <summary>{t("builder_summary_next_review")}</summary>
        <h3>{t("builder_before_signup")}</h3>
        <p>
          {b.reglas.length === 0
            ? t("builder_no_rules_summary", { count: b.n_empresas })
            : t("builder_rules_in_effect", { count: b.reglas.length })}
          {" "}{t("builder_portfolio_summary", { count: b.n_empresas, allocation: t(ETIQUETA_REPARTO[b.reparto] ?? b.reparto).toLowerCase(), sectorLimit: ETIQUETA_SECTOR_LIMITE(b.max_por_sector, t).toLowerCase(), cadence: t(cadaDia1Opcion === "revisar" ? "builder_review" : "builder_keep") })}
        </p>
      </details>

      <div className="field" hidden={etapa !== 4}>
        <span className="lbl">{t("builder_who_can_see")}</span>
        <div role="radiogroup" aria-label={t("builder_who_can_see")}>
          <OpcionRadio marcada={visibilidad === "privada"}
                       titulo={t("builder_result_only")}
                       ayuda={t("builder_result_only_help")}
                       onClick={() => { setVisibilidad("privada"); setDeclaraPosiciones(null); }} />
          <OpcionRadio marcada={visibilidad === "publicada"} disabled={!pro}
                       titulo={pro ? t("builder_published") : t("builder_published_pro")}
                       ayuda={t("builder_published_help")}
                       onClick={() => pro && setVisibilidad("publicada")} />
        </div>
        {visibilidad === "publicada" && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 16, color: "var(--ink)" }}>{t("builder_position_declaration")}</p>
            <div style={{ marginTop: 10 }}>
              <Segmentado etiquetaGrupo={t("builder_position_declaration")}
                          opciones={[{ valor: "si", etiqueta: t("builder_yes") }, { valor: "no", etiqueta: t("builder_no") }]}
                          valor={declaraPosiciones ?? ""}
                          onChange={(v) => setDeclaraPosiciones(v as "si" | "no")} />
            </div>
            <p className="fine">
              {t("builder_declaration_required")}
              {!declaraPosiciones && ` ${t("builder_choose_declaration")}`}
            </p>
          </div>
        )}
      </div>

      {error && <p className="aviso" role="alert" style={{ marginTop: 16 }}>{error}</p>}

      <div className="cta" hidden={etapa !== 4}>
        <p className="fine" style={{ textAlign: "center", marginTop: 2 }}>
          {t("builder_no_backtest")}
        </p>
      </div>
      </fieldset>
      </div>
      <div className="constructor-avanzar">
        {etapa > 0 && <Boton disabled={ocupado || convOcupado} onClick={() => void irEtapa(etapa - 1)}>{t("builder_previous")}</Boton>}
        {etapa < 4 && <Boton variante="principal" disabled={ocupado || convOcupado}
          onClick={() => void irEtapa(etapa + 1)}>{t("builder_continue_to", { step: t(ETAPAS[etapa + 1]).toLowerCase() })}</Boton>}
        {etapa === 4 && <Boton variante="principal" disabled={ocupado || convOcupado || !puedeApuntarse} onClick={apuntarse}>
          {ocupado ? t("builder_saving") : t("builder_save_signup")}
        </Boton>}
      </div>
      <BarraPestanas />
      <LecturasModal abierto={modalLecturas} tickers={tickersLecturas} activo={tickerLectura}
        lecturas={lecturas} leyendo={leyendo} error={errorLectura}
        onSeleccionar={setTickerLectura} onCerrar={() => setModalLecturas(false)} />
    </main>
  );
}

// ---- Editor de escudo (inline) --------------------------------------------------------------

const FORMAS: { valor: EscudoValor["forma"]; etiqueta: string }[] = [
  { valor: "circulo", etiqueta: "builder_shape_circle" }, { valor: "escudo", etiqueta: "builder_shape_shield" },
  { valor: "hexagono", etiqueta: "builder_shape_hexagon" },
];
const DIBUJOS: { valor: EscudoValor["dibujo"]; etiqueta: string }[] = [
  { valor: "liso", etiqueta: "builder_pattern_solid" }, { valor: "mitades", etiqueta: "builder_pattern_halves" },
  { valor: "diagonal", etiqueta: "builder_pattern_diagonal" }, { valor: "franja", etiqueta: "builder_pattern_stripe" },
];

function EditorEscudo({ valor, onChange }: { valor: EscudoValor; onChange: (v: EscudoValor) => void }) {
  const t = useTranslations();
  const dosColores = valor.dibujo !== "liso";
  return (
    <div className="tarjeta" style={{ marginTop: 14 }}>
      <div className="ce-top"><Escudo valor={valor} etiqueta={t("builder_crest_preview")} tamano={112} /></div>
      <p className="mini">{t("builder_shape")}</p>
      <div className="tiles t3">
        {FORMAS.map((f) => (
          <button key={f.valor} type="button" className="tile" aria-pressed={valor.forma === f.valor}
                  onClick={() => onChange({ ...valor, forma: f.valor })}>
            {t(f.etiqueta)}
          </button>
        ))}
      </div>
      <p className="mini">{t("builder_pattern")}</p>
      <div className="tiles t4">
        {DIBUJOS.map((d) => (
          <button key={d.valor} type="button" className="tile" aria-pressed={valor.dibujo === d.valor}
                  onClick={() => onChange({ ...valor, dibujo: d.valor })}>
            {t(d.etiqueta)}
          </button>
        ))}
      </div>
      <p className="mini">{t("builder_primary_color")}</p>
      <div className="swg">
        {PALETA.map((c) => (
          <button key={c} type="button" className="swb" style={{ background: c }}
                  aria-pressed={valor.color1 === c} aria-label={t("builder_color", { color: c })}
                  onClick={() => onChange({ ...valor, color1: c })} />
        ))}
      </div>
      {dosColores && (
        <>
          <p className="mini">{t("builder_secondary_color")}</p>
          <div className="swg">
            {PALETA.map((c) => (
              <button key={c} type="button" className="swb" style={{ background: c }}
                      aria-pressed={valor.color2 === c} aria-label={t("builder_color", { color: c })}
                      onClick={() => onChange({ ...valor, color2: c })} />
            ))}
          </div>
        </>
      )}
      <p className="mini">{t("builder_initials_optional")}</p>
      <input className="inp ini" maxLength={2} value={valor.iniciales ?? ""}
             onChange={(e) => onChange({ ...valor, iniciales: e.target.value.toUpperCase().replace(/[^A-ZÑ0-9]/g, "") })} />
      <p className="fine">
        {luminancia(valor.color1) > 0.4 ? t("builder_initials_dark_ink") : t("builder_initials_light_ink")}
      </p>
    </div>
  );
}
