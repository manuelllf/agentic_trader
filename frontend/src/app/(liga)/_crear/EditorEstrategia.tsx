"use client";

// Pantalla «Crear» (nueva estrategia o `/crear/[id]` para editar un borrador). Sigue el orden de
// bloques de docs/liguilla/DESIGN.md §7 «Crear», salvo el conversor de IA («¿Qué empresas te
// gustan?» → «Convertir en reglas»): esa fase es F6 y todavía no existe, así que no se pinta.
// «Ver qué entrarían hoy» y el editor de escudo van aquí mismo, en línea, en vez de como hojas a
// pantalla completa con URL propia (DESIGN.md §5): simplificación de F7 para no montar el sistema
// de hojas entero solo para estas dos pantallas (se nota en el informe).

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarraPestanas, Boton, CabeceraApp, Cargando, Escudo, ErrorLiga, OpcionRadio, Segmentado,
  escudoAleatorio, luminancia, PALETA, type EscudoValor,
} from "../_ui";
import {
  actualizarEstrategia, apuntar, buscarUniverso, convertirFrase, costeProbarConPregunta,
  crearEstrategia, crearReceta, excluirEmpresa, getCatalogo, getFicha,
  leerAFondo, leerMiCartera, porQueNoSale, probarEstrategia, quitarExclusion, verEstrategia,
  type Catalogo, type CostePregunta, type EmpresaBusqueda, type Estrategia, type Lectura,
  type Prueba, type ReglaElegida,
} from "@/lib/liga/api";
import { invalidar, obtener } from "@/lib/liga/cache";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { miles } from "@/lib/liga/format";

const RUTA_ACTUAL = (id?: string) => (id ? `/crear/${id}` : "/crear");

type Borrador = {
  reglas: ReglaElegida[];
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
  igual: "A partes iguales", nota: "Más a las mejores",
};
const ETIQUETA_SECTOR_LIMITE = (n: number) =>
  n === 0 ? "Sin límite" : n === 1 ? "1 por sector" : `${n} por sector`;

export function EditorEstrategia({ estrategiaIdInicial }: { estrategiaIdInicial?: string }) {
  const router = useRouter();
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

  const [editorEscudoAbierto, setEditorEscudoAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prueba, setPrueba] = useState<Prueba | string | null>(null);
  const [cambio, setCambio] = useState<{ entra: string; sale: string } | null>(null);
  const [costePregunta, setCostePregunta] = useState<CostePregunta | null>(null);
  const [leyendo, setLeyendo] = useState<string | null>(null);      // ticker en curso, o "cartera"
  const [lectura, setLectura] = useState<Lectura | Lectura[] | string | null>(null);
  const [buscaQ, setBuscaQ] = useState("");
  const [sugerencias, setSugerencias] = useState<EmpresaBusqueda[]>([]);
  const [porque, setPorque] = useState<{ ticker: string; nombre: string; texto: string } | null>(null);

  const [convFrase, setConvFrase] = useState("");
  const [convOcupado, setConvOcupado] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);
  const [convUsos, setConvUsos] = useState<{ hoy: number; tope: number } | null>(null);

  const nombreRef = useRef<HTMLInputElement>(null);
  const buscaId = useRef(0);
  const buscaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buscaAbort = useRef<AbortController | null>(null);

  // Limpieza al desmontar: no dejar un timer o una petición colgando.
  useEffect(() => () => {
    if (buscaTimer.current) clearTimeout(buscaTimer.current);
    buscaAbort.current?.abort();
  }, []);

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
        setB(receta ? {
          reglas: receta.reglas, excluidas: receta.excluidas, pregunta: receta.pregunta ?? "",
          pesos: { ...borradorInicial(cat).pesos, ...receta.pesos }, n_empresas: receta.n_empresas,
          reparto: receta.reparto, max_por_sector: receta.max_por_sector,
        } : borradorInicial(cat));
      } else {
        setB(borradorInicial(cat));
      }
      setCargandoInicial(false);
    })();
    return () => { vivo = false; };
  }, [sesionLista, estado, estrategiaIdInicial]);

  const pro = yo?.plan === "pro";
  const totalPesos = useMemo(
    () => (b ? Object.values(b.pesos).reduce((a, v) => a + v, 0) || 1 : 1), [b],
  );

  if (!sesionLista || cargandoInicial) {
    return (
      <main className="scroll">
        <h1 className="h1">{estrategiaIdInicial ? "Editar estrategia" : "Nueva estrategia"}</h1>
        <div style={{ marginTop: 20 }}><Cargando filas={4} /></div>
      </main>
    );
  }
  if (typeof catalogo === "string") {
    return (
      <main className="scroll">
        <ErrorLiga titulo="No se pudo cargar el catálogo" mensaje={catalogo}
                   accion={{ texto: "Reintentar", onClick: () => window.location.reload() }} />
      </main>
    );
  }
  if (errorCarga) {
    return (
      <main className="scroll">
        <ErrorLiga titulo="No se pudo abrir esta estrategia" mensaje={errorCarga}
                   accion={{ texto: "Volver a Mías", onClick: () => router.push("/mias") }} />
      </main>
    );
  }
  if (!catalogo || !b) return null;

  const reglasDisponibles = catalogo.reglas.filter((r) => !b.reglas.some((x) => x.clave === r.clave));
  const puedeApuntarse = !(visibilidad === "publicada" && !declaraPosiciones);

  function actualizarB(cambios: Partial<Borrador>) {
    setB((prev) => (prev ? { ...prev, ...cambios } : prev));
    setPrueba(null);
    setCambio(null);
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
    if (!nombre.trim()) {
      setError("Ponle nombre a tu estrategia antes de guardar.");
      nombreRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      nombreRef.current?.focus();
      return null;
    }
    setError(null);
    let idActual = id;
    const escudo = escudoParaApi(cr);
    if (!idActual) {
      const creada = await crearEstrategia(nombre.trim(), escudo);
      if (typeof creada === "string") { setError(creada); return null; }
      idActual = creada.id;
      setId(idActual);
      setEstrategia(creada);
      router.replace(`/crear/${idActual}`, { scroll: false });
    } else if (estrategia && (estrategia.nombre !== nombre.trim()
      || estrategia.escudo.forma !== escudo.forma || estrategia.escudo.dibujo !== escudo.dibujo
      || estrategia.escudo.color1 !== escudo.color1 || estrategia.escudo.color2 !== escudo.color2
      || estrategia.escudo.iniciales !== escudo.iniciales)) {
      const cambiada = await actualizarEstrategia(idActual, { nombre: nombre.trim(), ...escudo });
      if (typeof cambiada === "string") { setError(cambiada); return null; }
      setEstrategia(cambiada);
    }
    const receta = await crearReceta(idActual, {
      reglas: b!.reglas, excluidas: b!.excluidas, pregunta: pro ? (b!.pregunta || null) : null,
      pesos: { ...b!.pesos, pregunta: pro ? b!.pesos.pregunta : 0 }, n_empresas: b!.n_empresas,
      reparto: b!.reparto, max_por_sector: b!.max_por_sector,
    });
    if (typeof receta === "string") { setError(receta); return null; }
    return idActual;
  }

  async function verQueEntrarian() {
    setOcupado(true);
    setPrueba(null);
    setCambio(null);
    setCostePregunta(null);
    const idActual = await guardar();
    if (idActual) {
      const p = await probarEstrategia(idActual);
      setPrueba(p);
      if (b?.pregunta && pro) {
        const c = await costeProbarConPregunta(idActual);
        if (typeof c !== "string") setCostePregunta(c);
      }
    }
    setOcupado(false);
  }

  async function probarConPregunta() {
    if (!id) return;
    setOcupado(true);
    const p = await probarEstrategia(id, { idempotencia: crypto.randomUUID() });
    setPrueba(p);
    if (typeof p !== "string") {
      setCostePregunta(null);   // ya está cobrada y en caché
      invalidar("creditos");    // gasta créditos: el chip de la cabecera tiene que refrescarse
    }
    setOcupado(false);
  }

  async function leerFicha(ticker: string) {
    setLeyendo(ticker);
    setLectura(null);
    const r = await leerAFondo(ticker, crypto.randomUUID());
    setLectura(r);
    if (typeof r !== "string") invalidar("creditos");
    setLeyendo(null);
  }

  async function leerCarteraCompleta() {
    if (!id) return;
    setLeyendo("cartera");
    setLectura(null);
    const r = await leerMiCartera(id, crypto.randomUUID());
    if (typeof r !== "string") invalidar("creditos");
    setLectura(typeof r === "string" ? r : r.lecturas);
    setLeyendo(null);
  }

  async function cambiarEmpresa(ticker: string) {
    if (!id || typeof prueba !== "object" || !prueba) return;
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
    setPrueba(p);
    setOcupado(false);
  }

  async function deshacerCambio(ticker: string) {
    if (!id) return;
    setOcupado(true);
    const r = await quitarExclusion(id, ticker);
    if (typeof r === "string") { setError(r); setOcupado(false); return; }
    actualizarB({ excluidas: r.excluidas });
    const p = await probarEstrategia(id);
    setCambio(null);
    setPrueba(p);
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
    if (!id) { setPorque({ ticker: emp.ticker, nombre: emp.nombre ?? emp.ticker,
      texto: "Guarda tu estrategia (con «Ver qué entrarían hoy») para poder preguntar." }); return; }
    const r = await porQueNoSale(id, emp.ticker);
    setPorque({ ticker: emp.ticker, nombre: emp.nombre ?? emp.ticker,
      texto: typeof r === "string" ? r : r.motivo });
  }

  async function usarConversor() {
    if (!convFrase.trim()) return;
    setConvOcupado(true);
    setConvError(null);
    const r = await convertirFrase(convFrase.trim());
    setConvOcupado(false);
    if (typeof r === "string") { setConvError(r); return; }
    setConvUsos({ hoy: r.usos_hoy, tope: r.usos_tope });
    // Solo rellena el borrador: nada se guarda hasta que el usuario pulse «Ver qué entrarían hoy»
    // o «Apuntarme», igual que si lo hubiera construido a mano.
    const clavesConocidas = new Set((catalogo as Catalogo).reglas.map((c) => c.clave));
    const reglasNuevas = r.reglas.filter(
      (nueva) => clavesConocidas.has(nueva.clave) && !b!.reglas.some((x) => x.clave === nueva.clave),
    );
    actualizarB({
      reglas: [...b!.reglas, ...reglasNuevas],
      pesos: r.pesos ? { ...b!.pesos, ...r.pesos } : b!.pesos,
      pregunta: pro && r.pregunta ? r.pregunta : b!.pregunta,
    });
    if (r.nombre && !nombre.trim()) setNombre(r.nombre);
    setConvFrase("");
  }

  async function apuntarse() {
    setOcupado(true);
    const idActual = await guardar();
    if (idActual) {
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

  const wkeys = catalogo.pesos.claves.filter((k) => pro || k !== "pregunta");

  return (
    <main className="scroll">
      <CabeceraApp conCreditos />
      <h1 className="h1">{estrategiaIdInicial ? "Editar estrategia" : "Nueva estrategia"}</h1>
      <p className="meta">
        Se aplica a unas 3.000 empresas de EE. UU., con los datos del día 1 de cada mes.
      </p>

      <div className="field">
        <span className="lbl">
          Tus reglas
          <small>Filtros exactos: una empresa que no cumple una regla no entra.</small>
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
                            aria-label={`Quitar ${def.titulo}`}>×</button>
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
          <div className="starters" style={{ marginTop: b.reglas.length > 0 ? 12 : 0 }}>
            {reglasDisponibles.map((r) => (
              <button key={r.clave} type="button" className="starter" onClick={() => anadirRegla(r.clave)}>
                + {r.titulo}
              </button>
            ))}
          </div>
        )}
        {b.reglas.length === 0 && (
          <p className="fine" style={{ marginTop: 0 }}>Sin reglas, pasan todas las empresas.</p>
        )}
      </div>

      <div className="field">
        <label className="lbl" htmlFor="convFrase">
          ¿No encuentras el filtro? Descríbelo
          <small>
            La IA sugiere reglas del catálogo a partir de tu frase; tú decides si te las quedas.
            {convUsos && ` Te quedan ${Math.max(0, convUsos.tope - convUsos.hoy)} usos hoy.`}
          </small>
        </label>
        <textarea id="convFrase" className="inp" maxLength={300} rows={2}
                  placeholder="p. ej. empresas grandes, con poca deuda, que no estén caras"
                  value={convFrase} onChange={(e) => setConvFrase(e.target.value)} />
        <div style={{ marginTop: 8 }}>
          <Boton variante="secundario" disabled={convOcupado || !convFrase.trim()}
                 onClick={usarConversor}>
            {convOcupado ? "Pensando…" : "Convertir en reglas"}
          </Boton>
        </div>
        {convError && <p className="fine" style={{ color: "var(--danger, #e66767)" }}>{convError}</p>}
      </div>

      <div className="field">
        <label className="lbl" htmlFor="cQ">
          Tu pregunta a la IA
          <small>
            {pro
              ? "La contesta empresa a empresa, solo en las que pasan tus reglas."
              : "Con Pro, la IA contesta tu propia pregunta empresa a empresa."}
          </small>
        </label>
        {pro ? (
          <textarea id="cQ" className="inp" maxLength={160}
                    placeholder="Algo que no se pueda medir con un número"
                    value={b.pregunta} onChange={(e) => actualizarB({ pregunta: e.target.value })} />
        ) : (
          <div className="lock">
            Escribir tu propia pregunta es de Pro.
            <div><Boton variante="principal" disabled>Pasar a Pro · 4,99&nbsp;€ al mes</Boton></div>
          </div>
        )}
      </div>

      <div className="field">
        <span className="lbl">Qué pesa más<small>Al ordenar las empresas que pasan tus reglas.</small></span>
        {wkeys.map((k) => (
          <div className="wrow" key={k}>
            <label htmlFor={`w-${k}`}>{catalogo!.pesos.etiquetas[k]}</label>
            <span className="num">{Math.round((b.pesos[k] * 100) / totalPesos)}&nbsp;%</span>
            <div className="wbar"><i style={{ width: `${Math.round((b.pesos[k] * 100) / totalPesos)}%` }} /></div>
            <input id={`w-${k}`} type="range" min={0} max={catalogo!.pesos.maximo} step={catalogo!.pesos.paso}
                   value={b.pesos[k]} style={{ gridColumn: "1 / -1" }}
                   onChange={(e) => actualizarB({ pesos: { ...b.pesos, [k]: Number(e.target.value) } })} />
          </div>
        ))}
      </div>

      <div className="field">
        <span className="lbl">¿Cuántas empresas?</span>
        <Segmentado etiquetaGrupo="Número de empresas"
                    opciones={catalogo.n_empresas.map((n) => ({ valor: n, etiqueta: String(n) }))}
                    valor={b.n_empresas} onChange={(n) => actualizarB({ n_empresas: n })} />
        <div style={{ marginTop: 8 }}>
          <Segmentado etiquetaGrupo="Reparto"
                      opciones={catalogo.repartos.map((r) => ({ valor: r, etiqueta: ETIQUETA_REPARTO[r] ?? r }))}
                      valor={b.reparto} onChange={(r) => actualizarB({ reparto: r })} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Segmentado etiquetaGrupo="Máximo por sector"
                      opciones={[0, 1, 2].map((n) => ({ valor: n, etiqueta: ETIQUETA_SECTOR_LIMITE(n) }))}
                      valor={b.max_por_sector} onChange={(n) => actualizarB({ max_por_sector: n })} />
        </div>
        <p className="sub-lbl">Cada día 1</p>
        <div role="radiogroup" aria-label="Cada día 1">
          <OpcionRadio marcada={cadaDia1Opcion === "revisar"} titulo="Revisarla"
                       ayuda="Se vuelven a pasar tus reglas: entran las nuevas y salen las que ya no cumplen."
                       onClick={() => setCadaDia1Opcion("revisar")} />
          <OpcionRadio marcada={cadaDia1Opcion === "mantener"} titulo="Mantenerla"
                       ayuda="Se queda con las que tiene hasta que tú pidas cambiarla, siempre un día 1."
                       onClick={() => setCadaDia1Opcion("mantener")} />
        </div>
      </div>

      <div className="field">
        <span className="lbl">Cómo se forma tu cartera</span>
        <div className="recipe">
          <b>~3.000</b><span>empresas de EE. UU., con los datos del día 1</span>
          <b>{typeof prueba === "object" && prueba ? miles(prueba.pasan) : "?"}</b>
          <span>pasan tus reglas</span>
          <b>{b.n_empresas}</b>
          <span>entran: las de mejor nota{b.max_por_sector === 0 ? "" : `, como mucho ${b.max_por_sector} por sector`}</span>
          <b>{b.reparto === "igual" ? `${Math.round(100 / b.n_empresas)} %` : "+"}</b>
          <span>{b.reparto === "igual" ? "para cada una" : "peso para las de mejor nota"}</span>
        </div>
        <p className="recipe-note">
          {cadaDia1Opcion === "revisar" ? "Cada día 1 se repite con los datos nuevos."
            : "Después se queda así hasta que tú pidas cambiarla."} Probar no cambia nada.
        </p>
        <Boton variante="secundario" ancho="completo" style={{ marginTop: 14 }}
               disabled={ocupado} onClick={verQueEntrarian}>
          {ocupado ? "Probando…" : "Ver qué empresas entrarían hoy"}
        </Boton>
        {typeof prueba === "string" && (
          <p className="fine" style={{ textAlign: "center" }} role="status">{prueba}</p>
        )}
        {typeof prueba === "object" && prueba && b?.pregunta && pro && costePregunta && costePregunta.faltan > 0 && (
          <Boton variante="secundario" ancho="completo" style={{ marginTop: 8 }}
                 disabled={ocupado} onClick={probarConPregunta}>
            {ocupado ? "Preguntando…"
              : `Probar con tu pregunta · ${costePregunta.creditos} crédito${costePregunta.creditos === 1 ? "" : "s"}`}
          </Boton>
        )}
        {typeof prueba === "object" && prueba && (
          <div style={{ marginTop: 14 }}>
            <p className="meta">
              De unas 3.000 empresas pasan tus reglas {miles(prueba.pasan)}. Entran {prueba.elegidas.length}:
            </p>
            {prueba.elegidas.map((e) => {
              const esCambio = cambio?.entra === e.ticker ? cambio : null;
              return (
                <div className="pick" key={e.ticker}>
                  <div>
                    <b>{e.nombre ?? e.ticker}</b>
                    <span>{e.ticker} · {e.sector ?? "sin sector"}</span>
                    <small>
                      {esCambio && <span className="new">Entra en lugar de {esCambio.sale}. </span>}
                      {e.porque}
                    </small>
                    <div className="links">
                      {esCambio && (
                        <button type="button" className="link" onClick={() => deshacerCambio(esCambio.sale)}>
                          Deshacer
                        </button>
                      )}
                      <button type="button" className="link" disabled={leyendo === e.ticker}
                              onClick={() => leerFicha(e.ticker)}>
                        {leyendo === e.ticker ? "Leyendo…" : "Leer a fondo · 5 créditos"}
                      </button>
                    </div>
                  </div>
                  <div className="pick-r">
                    <span className="num">{Math.round(e.peso)}&nbsp;%</span>
                    <button type="button" onClick={() => cambiarEmpresa(e.ticker)} disabled={ocupado}>
                      Cambiar
                    </button>
                  </div>
                </div>
              );
            })}
            {prueba.caja_pct > 0.5 && (
              <p className="fine">
                Solo {prueba.elegidas.length} cumplen tus reglas; el {Math.round(prueba.caja_pct)}&nbsp;%
                restante se queda en caja.
              </p>
            )}
            {prueba.elegidas.length > 0 && (
              <Boton variante="secundario" ancho="completo" style={{ marginTop: 8 }}
                     disabled={leyendo === "cartera"} onClick={leerCarteraCompleta}>
                {leyendo === "cartera" ? "Leyendo…"
                  : `Leer mi cartera · hasta ${prueba.elegidas.length * 5} créditos`}
              </Boton>
            )}
            {leyendo === null && lectura !== null && (
              <div className="field" style={{ marginTop: 10 }}>
                {typeof lectura === "string" && <p className="fine" role="status">{lectura}</p>}
                {!Array.isArray(lectura) && lectura && typeof lectura !== "string" && (
                  <div className="pick" style={{ display: "block" }}>
                    <b>{lectura.ticker}</b>
                    <p className="meta" style={{ whiteSpace: "pre-wrap" }}>{lectura.texto}</p>
                    <button type="button" className="link" onClick={() => setLectura(null)}>Cerrar</button>
                  </div>
                )}
                {Array.isArray(lectura) && lectura.map((l) => (
                  <div className="pick" style={{ display: "block" }} key={l.id}>
                    <b>{l.ticker}</b>
                    <p className="meta" style={{ whiteSpace: "pre-wrap" }}>{l.texto}</p>
                  </div>
                ))}
                {Array.isArray(lectura) && (
                  <button type="button" className="link" onClick={() => setLectura(null)}>Cerrar</button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="field">
          <label className="lbl" htmlFor="qSearch">
            ¿Por qué no sale X?<small>Búscala y te decimos si entraría y por qué.</small>
          </label>
          <input id="qSearch" className="inp" autoComplete="off" placeholder="Nombre o ticker, por ejemplo Apple"
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
        </div>
      </div>

      <div className="field">
        <label className="lbl" htmlFor="cName">
          Nombre y escudo<small>Es lo único que se ve de ti en la liga.</small>
        </label>
        <input ref={nombreRef} id="cName" className="inp" value={nombre} maxLength={28}
               autoComplete="off" placeholder="Ponle nombre" onChange={(e) => setNombre(e.target.value)} />
        <div className="crest-ed">
          <button type="button" className="crest-btn" aria-label="Editar el escudo"
                  onClick={() => setEditorEscudoAbierto((v) => !v)}>
            <Escudo valor={cr} etiqueta="Vista previa del escudo" tamano={72} />
          </button>
          <div className="crest-acts">
            <Boton tamano="pequeno" onClick={() => setEditorEscudoAbierto((v) => !v)}>
              {editorEscudoAbierto ? "Cerrar editor" : "Editar escudo"}
            </Boton>
            <Boton tamano="pequeno" onClick={() => setCr(escudoAleatorio())}>Otro al azar</Boton>
          </div>
        </div>
        {editorEscudoAbierto && (
          <EditorEscudo valor={cr} onChange={setCr} />
        )}
      </div>

      <div className="review">
        <h3>Antes de apuntarla</h3>
        <p>
          {b.reglas.length === 0
            ? "Sin reglas, entran las 5 empresas mejor puntuadas de todo el mercado."
            : `${b.reglas.length} ${b.reglas.length === 1 ? "regla" : "reglas"} en marcha.`}
          {" "}Cartera de {b.n_empresas}, {ETIQUETA_REPARTO[b.reparto]?.toLowerCase() ?? b.reparto},
          {" "}{ETIQUETA_SECTOR_LIMITE(b.max_por_sector).toLowerCase()}.
          {" "}{cadaDia1Opcion === "revisar" ? "Se revisa" : "Se mantiene"} cada día 1.
        </p>
      </div>

      <div className="field">
        <span className="lbl">¿Quién la ve?</span>
        <div role="radiogroup" aria-label="Quién la ve">
          <OpcionRadio marcada={visibilidad === "privada"}
                       titulo="Solo su resultado"
                       ayuda="En la liga se ven el nombre y cómo va. Nada más."
                       onClick={() => { setVisibilidad("privada"); setDeclaraPosiciones(null); }} />
          <OpcionRadio marcada={visibilidad === "publicada"} disabled={!pro}
                       titulo={pro ? "Publicada" : "Publicada (Pro)"}
                       ayuda="Los de Pro ven tus reglas, tu pregunta y tu cartera, y pueden copiarla."
                       onClick={() => pro && setVisibilidad("publicada")} />
        </div>
        {visibilidad === "publicada" && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 16, color: "var(--ink)" }}>¿Tienes o piensas tener estas acciones?</p>
            <div style={{ marginTop: 10 }}>
              <Segmentado etiquetaGrupo="Declaración de posiciones"
                          opciones={[{ valor: "si", etiqueta: "Sí" }, { valor: "no", etiqueta: "No" }]}
                          valor={declaraPosiciones ?? "no"}
                          onChange={(v) => setDeclaraPosiciones(v as "si" | "no")} />
            </div>
            <p className="fine">Es obligatorio para publicar y se muestra junto a tu estrategia.</p>
          </div>
        )}
      </div>

      {error && <p className="aviso" role="alert" style={{ marginTop: 16 }}>{error}</p>}

      <div className="cta">
        <Boton variante="principal" ancho="completo" disabled={ocupado || !puedeApuntarse} onClick={apuntarse}>
          {ocupado ? "Guardando…" : "Apuntarla"}
        </Boton>
        <p className="fine" style={{ textAlign: "center", marginTop: 2 }}>
          Sin pruebas hacia atrás: todo cuenta desde el próximo día 1.
        </p>
      </div>

      <BarraPestanas />
    </main>
  );
}

// ---- Editor de escudo (inline) --------------------------------------------------------------

const FORMAS: { valor: EscudoValor["forma"]; etiqueta: string }[] = [
  { valor: "circulo", etiqueta: "Círculo" }, { valor: "escudo", etiqueta: "Escudo" },
  { valor: "hexagono", etiqueta: "Hexágono" },
];
const DIBUJOS: { valor: EscudoValor["dibujo"]; etiqueta: string }[] = [
  { valor: "liso", etiqueta: "Liso" }, { valor: "mitades", etiqueta: "Mitades" },
  { valor: "diagonal", etiqueta: "Diagonal" }, { valor: "franja", etiqueta: "Franja" },
];

function EditorEscudo({ valor, onChange }: { valor: EscudoValor; onChange: (v: EscudoValor) => void }) {
  const dosColores = valor.dibujo !== "liso";
  return (
    <div className="tarjeta" style={{ marginTop: 14 }}>
      <div className="ce-top"><Escudo valor={valor} etiqueta="Vista previa del escudo" tamano={112} /></div>
      <p className="mini">Forma</p>
      <div className="tiles t3">
        {FORMAS.map((f) => (
          <button key={f.valor} type="button" className="tile" aria-pressed={valor.forma === f.valor}
                  onClick={() => onChange({ ...valor, forma: f.valor })}>
            {f.etiqueta}
          </button>
        ))}
      </div>
      <p className="mini">Dibujo</p>
      <div className="tiles t4">
        {DIBUJOS.map((d) => (
          <button key={d.valor} type="button" className="tile" aria-pressed={valor.dibujo === d.valor}
                  onClick={() => onChange({ ...valor, dibujo: d.valor })}>
            {d.etiqueta}
          </button>
        ))}
      </div>
      <p className="mini">Color principal</p>
      <div className="swg">
        {PALETA.map((c) => (
          <button key={c} type="button" className="swb" style={{ background: c }}
                  aria-pressed={valor.color1 === c} aria-label={`Color ${c}`}
                  onClick={() => onChange({ ...valor, color1: c })} />
        ))}
      </div>
      {dosColores && (
        <>
          <p className="mini">Color secundario</p>
          <div className="swg">
            {PALETA.map((c) => (
              <button key={c} type="button" className="swb" style={{ background: c }}
                      aria-pressed={valor.color2 === c} aria-label={`Color ${c}`}
                      onClick={() => onChange({ ...valor, color2: c })} />
            ))}
          </div>
        </>
      )}
      <p className="mini">Iniciales (opcional)</p>
      <input className="inp ini" maxLength={2} value={valor.iniciales ?? ""}
             onChange={(e) => onChange({ ...valor, iniciales: e.target.value.toUpperCase().replace(/[^A-ZÑ0-9]/g, "") })} />
      <p className="fine">
        {luminancia(valor.color1) > 0.4 ? "Iniciales en tinta oscura." : "Iniciales en tinta clara."}
      </p>
    </div>
  );
}
