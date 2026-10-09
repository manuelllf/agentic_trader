import { browserText } from "../../i18n/browser";
// Cliente de la API de la liga (`/liga/*`). Manda el token de Supabase; las salas usan lib/api.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenciaFormacion } from "./evidencia";
import { avisarError } from "./errores";
import { sesionCaducada, tokenSesion } from "./supabase";
import { browserLocale, type Locale } from "../../i18n/locale";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Yo = {
  pendiente: boolean;
  alias: string;
  plan: "gratis" | "pro";
  puede_crear_liga: boolean;
  roles: string[];
  admin: boolean;
  aal2: boolean;
  idioma?: Locale | null;
};

export async function guardarIdioma(idioma: Locale, owner: string): Promise<{ idioma: Locale } | string> {
  const sesion = await tokenSesion();
  if (!sesion || sesion.uid !== owner) return SIN_SESION();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${API_URL}/liga/yo/idioma`, {
      method: "PUT", cache: "no-store", signal: controller.signal,
      headers: { Authorization: `Bearer ${sesion.token}`, "Content-Type": "application/json",
        "Accept-Language": browserLocale() },
      body: JSON.stringify({ idioma }),
    });
    if (response.ok) return await response.json() as { idioma: Locale };
    return SIN_RED();
  } catch { return SIN_RED(); }
  finally { clearTimeout(timeout); }
}

/** Entrar con el nombre de usuario: el backend busca el correo (nunca llega aquí) y devuelve la
 *  sesión, que se instala en el cliente de Supabase. null si ha ido bien; si no, el motivo. */
export async function entrarConAlias(
  sb: SupabaseClient, usuario: string, clave: string,
): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/liga/entrar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": browserLocale() },
      body: JSON.stringify({ usuario: usuario.trim(), clave }),
      cache: "no-store",
    });
  } catch {
    return browserText("system_signin_failed");
  }
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => ({}))) as { detail?: string };
    return cuerpo.detail ?? browserText("system_signin_failed");
  }
  const sesion = (await res.json()) as { access_token: string; refresh_token: string };
  const { error } = await sb.auth.setSession(sesion);
  return error ? browserText("system_signin_failed") : null;
}

/** Cambia el alias. Devuelve el perfil nuevo o el motivo por el que no se pudo. */
export async function cambiarAlias(alias: string): Promise<Yo | string> {
  const sesion = await tokenSesion();
  if (!sesion) return browserText("system_session_expired");
  try {
    const res = await fetch(`${API_URL}/liga/yo`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${sesion.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ alias }),
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as Yo;
    const cuerpo = (await res.json().catch(() => ({}))) as { detail?: unknown };
    return typeof cuerpo.detail === "string" ? cuerpo.detail : browserText("system_save_failed");
  } catch {
    return browserText("system_save_failed");
  }
}

export async function aceptarTerminos(): Promise<Yo | string> {
  const sesion = await tokenSesion();
  if (!sesion) return browserText("system_session_expired");
  try {
    const res = await fetch(`${API_URL}/liga/yo/terminos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sesion.token}` },
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as Yo;
    const cuerpo = (await res.json().catch(() => ({}))) as { detail?: unknown };
    return typeof cuerpo.detail === "string" ? cuerpo.detail : browserText("system_save_failed");
  } catch {
    return browserText("system_save_failed");
  }
}

/** Quién eres según el backend; null sin sesión o sin perfil, y lanza si no responde. */
export async function getYo(): Promise<Yo | null> {
  const resultado = await llamar<Yo | null>("/liga/yo");
  if (resultado === SIN_SESION() || resultado === null) return null;
  if (typeof resultado === "string") throw new Error(resultado);
  return resultado;
}

// ---- Estrategias (crear/editar, receta, pruebas, ficha...) -------------------------------------
//
// Mensajes de error: el `detail` que manda la API ya está en castellano y se enseña tal cual
// (DESIGN.md §10); `SIN_SESION()`/`SIN_RED()` son los únicos que inventamos aquí.

const SIN_SESION = () => browserText("system_session_expired");
const SIN_RED = () => browserText("system_connection_failed");

export type Escudo = {
  forma: "circulo" | "escudo" | "hexagono";
  dibujo: "liso" | "mitades" | "diagonal" | "franja";
  color1: string;
  color2: string | null;
  iniciales: string | null;
};

export type EstadoEstrategia = "borrador" | "apuntada" | "jugando" | "retirada" | string;

export type Estrategia = {
  id: string;
  nombre: string;
  escudo: Escudo;
  visibilidad: "privada" | "publicada";
  declara_posiciones: "si" | "no" | null;
  destacable: boolean;
  estado: EstadoEstrategia;
  cada_dia_1: "revisar" | "mantener";
  oculta: boolean;
  receta_id: number | null;
  opta_premio: boolean;
  creada: string;
  actualizada: string;
};

export type ParametroRegla = {
  nombre: string;
  etiqueta: string;
  tipo: string;
  minimo: number | null;
  maximo: number | null;
  paso: number | null;
  defecto: number | string | null;
  opcional?: boolean;
};

export type ReglaCatalogo = { clave: string; titulo: string; parametros: ParametroRegla[] };

export type Catalogo = {
  version: number;
  sectores: Record<string, string>;
  reglas: ReglaCatalogo[];
  pesos: { claves: string[]; etiquetas: Record<string, string>; maximo: number; paso: number };
  n_empresas: number[];
  repartos: string[];
  max_por_sector: number;
  max_excluidas: number;
};

export type ReglaElegida = { clave: string; params: Record<string, unknown> };

export type Receta = {
  id: number;
  idea: string | null;
  reglas: ReglaElegida[];
  excluidas: string[];
  catalogo_version: number;
  pregunta: string | null;
  pesos: Record<string, number>;
  n_empresas: number;
  reparto: string;
  max_por_sector: number;
  creada: string;
};

export type RecetaEntrada = {
  idea?: string | null;
  reglas: ReglaElegida[];
  excluidas: string[];
  pregunta?: string | null;
  pesos: Record<string, number>;
  n_empresas: number;
  reparto: string;
  max_por_sector: number;
};

export type EmpresaElegida = {
  ticker: string;
  nombre: string | null;
  sector: string | null;
  peso: number;
  porque: string;
};

export type Prueba = {
  id: string;
  foto_id: number;
  scan_run_id: number;
  plan_b: boolean;
  catalogo_version: number;
  evaluadas: number;
  pasan: number;
  elegidas: EmpresaElegida[];
  saltadas_por_sector: number;
  sin_peso: number;
  sin_notas: number;
  sin_respuesta: number;
  caja_pct: number;
  // Solo si se probó «con tu pregunta» (F6-B).
  pregunta_desde_cache?: number | null;
  pregunta_nuevas?: number | null;
  creditos_cobrados?: number | null;
};

/** Counts and portfolio previewed from the latest saved market photo; this never creates a test. */
export type PreviewSeleccion = {
  catalogo_version: number;
  sin_peso: number | null;
  explicacion: string | null;
  estado: "disponible" | "incompleto" | "sin_datos";
  mensaje: string;
  plan_b: boolean | null;
  foto_id: number | null;
  scan_run_id: number | null;
  evaluadas: number | null;
  cumplen_reglas: number | null;
  candidatas_ordenadas: number | null;
  seleccionadas: number | null;
  sin_notas: number | null;
  sin_respuesta: number | null;
  saltadas_por_sector: number | null;
  caja_pct: number | null;
  elegidas: EmpresaElegida[];
};

export type PorQue = { ticker: string; motivo: string };
export type EmpresaBusqueda = { ticker: string; nombre: string | null; sector: string | null };

export type JornadaFicha = { numero: number; rentabilidad: number | null; puntos: number | null };
export type Posicion = { ticker: string; peso: number };
export type MercadoFicha = {
  desde: string; dia: string; consultado: string | null; en_vivo: boolean;
  rentabilidad: number | null; sp500: number | null; diferencia: number | null;
  empresas: Record<string, { precio: number | null; rentabilidad: number | null; dia: string | null } | null>;
};

export type Ficha = {
  id: string;
  nombre: string;
  escudo: Escudo;
  casa: "alpha" | "omega" | "lambda" | null;
  autor: string | null;
  estado: string;
  visibilidad: string;
  es_dueno: boolean;
  jornadas: JornadaFicha[];
  receta: Receta | null;
  posiciones: Posicion[];
  rendimiento?: RendimientoFicha | null;
  mercado?: MercadoFicha | null;
  casa_metodologia?: { resumen: string; pasos: { titulo: string; texto: string }[] } | null;
};

export type RendimientoFicha = {
  estado: "disponible" | "sin_datos" | "privado";
  metodologia: string;
  oficial_hasta: string | null;
  provisional_hasta: string | null;
  incompleta?: boolean;
  evidencia?: EvidenciaFormacion | null;
  serie: { dia: string; estrategia: number; sp500: number; provisional: boolean; salto?: boolean;
    jornada?: number | null }[];
  metricas: { sharpe: number | null; sortino: number | null; volatilidad: number | null;
    max_drawdown: number | null; observaciones: number } | null;
};

export type ContenidoBorrador = {
  nombre: string; idea: string; etapa: number; escudo: Escudo; receta: RecetaEntrada;
  interpretacion?: InterpretacionIdea[];
  visibilidad: "privada" | "publicada"; declara_posiciones: "si" | "no" | null;
  cada_dia_1: "revisar" | "mantener";
};
export type BorradorGuardado = { revision: number; contenido: ContenidoBorrador; actualizado: string };
export const leerBorrador = (clave: string) => llamar<BorradorGuardado | null>(`/liga/borradores/${clave}`);
export const guardarBorrador = (clave: string, revision: number, contenido: ContenidoBorrador, usuario?: string) =>
  llamar<BorradorGuardado>(`/liga/borradores/${clave}`, {
    method: "PUT", body: JSON.stringify({ revision, contenido }),
  }, true, 15_000, usuario);
export const borrarBorrador = (clave: string, revision: number) =>
  llamar<void>(`/liga/borradores/${clave}?revision=${revision}`, { method: "DELETE" });
export const vincularBorrador = (id: string, revision: number) =>
  llamar<void>(`/liga/borradores/nueva/vincular/${id}?revision=${revision}`, { method: "POST" });

export async function llamar<T>(
  ruta: string,
  opciones: RequestInit = {},
  conSesion = true,
  timeout = opciones.method && opciones.method !== "GET" ? 60000 : 15000,
  usuarioEsperado?: string,
): Promise<T | string> {
  const ctrl = new AbortController();
  const abortar = () => ctrl.abort();
  opciones.signal?.addEventListener("abort", abortar, { once: true });
  if (opciones.signal?.aborted) ctrl.abort();
  let agotado = false;
  const timer = setTimeout(() => { agotado = true; ctrl.abort(); }, timeout);
  try {
  const cabeceras: Record<string, string> = { "Accept-Language": browserLocale(),
    ...(opciones.headers as Record<string, string> ?? {}) };
  if (conSesion) {
    const sesion = await tokenSesion(ctrl.signal);
    if (!sesion) return SIN_SESION();
    if (usuarioEsperado && sesion.uid !== usuarioEsperado) return browserText("system_account_changed");
    cabeceras.Authorization = `Bearer ${sesion.token}`;
  }
  if (opciones.body) cabeceras["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${ruta}`, { ...opciones, signal: ctrl.signal, headers: cabeceras, cache: "no-store" });
  } catch (err) {
    if (agotado) return browserText("system_request_timeout");
    // Una petición cancelada a propósito (AbortController, p. ej. el buscador) no es un error de
    // red: se deja subir para que quien la canceló la distinga de una respuesta real.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    // Sin internet no hay nada que reportar: el aviso es para cuando el fallo es nuestro.
    if (typeof navigator === "undefined" || navigator.onLine) avisarError(SIN_RED());
    return SIN_RED();
  }
  if (res.status === 401 && conSesion) {
    void sesionCaducada();
    return SIN_SESION();
  }
  if (res.status === 204) return undefined as T;
  if (ruta === "/liga/yo" && res.status === 404) return null as T;
  const cuerpo = await res.json();
  if (res.ok) return cuerpo as T;
  const detalle = (cuerpo as { detail?: unknown } | null)?.detail;
  const mensaje = typeof detalle === "string" ? detalle : SIN_RED();
  // Un 5xx es un fallo nuestro: además del mensaje en su pantalla, sale el aviso para reportarlo.
  if (res.status >= 500) avisarError(mensaje);
  return mensaje;
  } catch (err) {
    if (opciones.signal?.aborted) throw err;
    return agotado ? browserText("system_request_timeout") : SIN_RED();
  } finally {
    clearTimeout(timer);
    opciones.signal?.removeEventListener("abort", abortar);
  }
}

/** Catálogo de reglas, pesos y opciones de la receta. Público: no hace falta sesión. */
export async function getCatalogo(): Promise<Catalogo | string> {
  return llamar<Catalogo>("/liga/catalogo", {}, false);
}

export async function misEstrategias(): Promise<Estrategia[] | string> {
  return llamar<Estrategia[]>("/liga/estrategias");
}

export async function verEstrategia(id: string): Promise<Estrategia | string> {
  return llamar<Estrategia>(`/liga/estrategias/${id}`);
}

export async function crearEstrategia(
  nombre: string, escudo: Escudo,
): Promise<Estrategia | string> {
  return llamar<Estrategia>("/liga/estrategias", {
    method: "POST", body: JSON.stringify({ nombre, escudo }),
  });
}

export type EstrategiaPatch = Partial<{
  nombre: string;
  forma: Escudo["forma"];
  dibujo: Escudo["dibujo"];
  color1: string;
  color2: string;
  iniciales: string | null;
  visibilidad: "privada" | "publicada";
  declara_posiciones: "si" | "no";
  cada_dia_1: "revisar" | "mantener";
}>;

export async function actualizarEstrategia(
  id: string, cambios: EstrategiaPatch,
): Promise<Estrategia | string> {
  return llamar<Estrategia>(`/liga/estrategias/${id}`, {
    method: "PATCH", body: JSON.stringify(cambios),
  });
}

export async function borrarEstrategia(id: string): Promise<true | string> {
  const r = await llamar<undefined>(`/liga/estrategias/${id}`, { method: "DELETE" });
  return typeof r === "string" ? r : true;
}

export async function crearReceta(
  id: string, receta: RecetaEntrada,
): Promise<Receta | string> {
  return llamar<Receta>(`/liga/estrategias/${id}/receta`, {
    method: "POST", body: JSON.stringify(receta),
  });
}

export async function apuntar(id: string): Promise<Estrategia | string> {
  return llamar<Estrategia>(`/liga/estrategias/${id}/apuntar`, { method: "POST" });
}

export async function desapuntar(id: string): Promise<Estrategia | string> {
  return llamar<Estrategia>(`/liga/estrategias/${id}/desapuntar`, { method: "POST" });
}

export async function optarAlPremio(id: string): Promise<Estrategia[] | string> {
  return llamar<Estrategia[]>(`/liga/estrategias/${id}/premio`, { method: "POST" });
}

export async function cadaDia1(
  id: string, opcion: "revisar" | "mantener",
): Promise<Estrategia | string> {
  return llamar<Estrategia>(`/liga/estrategias/${id}/cada-dia-1`, {
    method: "POST", body: JSON.stringify({ opcion }),
  });
}

export async function excluirEmpresa(id: string, ticker: string): Promise<Receta | string> {
  return llamar<Receta>(`/liga/estrategias/${id}/exclusiones/${encodeURIComponent(ticker)}`, {
    method: "POST",
  });
}

export async function quitarExclusion(id: string, ticker: string): Promise<Receta | string> {
  return llamar<Receta>(`/liga/estrategias/${id}/exclusiones/${encodeURIComponent(ticker)}`, {
    method: "DELETE",
  });
}

/** Una estrategia en la ventana de cambios: desde el corte hasta que abre la jornada. */
export interface EmpresaVentana { ticker: string; nombre: string | null; sector: string | null; peso: number | string }
export interface Ventana {
  estrategia_id: string;
  fase: "formando" | "cambios";
  jornada_id: number;
  cierra: string;
  cartera: EmpresaVentana[];
  quitadas: { ticker: string; nombre: string | null }[];
  quitadas_formacion: string[];
}

export async function miVentana(): Promise<Ventana[] | string> {
  return llamar<Ventana[]>("/liga/estrategias/ventana");
}

export async function volverALaFormacion(id: string): Promise<Receta | string> {
  return llamar<Receta>(`/liga/estrategias/${id}/formacion/volver`, { method: "POST" });
}

export async function probarEstrategia(
  id: string, conPregunta?: { idempotencia: string },
): Promise<Prueba | string> {
  return llamar<Prueba>(`/liga/estrategias/${id}/pruebas`, {
    method: "POST",
    body: JSON.stringify(conPregunta ? { con_pregunta: true, ...conPregunta } : {}),
  }, true, 210000);
}

/** Read-only preview of a draft recipe against saved data; the abort signal drops stale edits. */
export async function previsualizarSeleccion(
  receta: RecetaEntrada & { ticker?: string }, signal?: AbortSignal,
): Promise<PreviewSeleccion | string> {
  return llamar<PreviewSeleccion>("/liga/seleccion/preview", {
    method: "POST", body: JSON.stringify(receta), signal,
  }, true, 15000);
}

export type CostePregunta = {
  evaluadas: number;
  en_cache: number;
  faltan: number;
  creditos: number;
};

/** Coste en créditos de «Probar con tu pregunta»: cuántas de las candidatas faltan por
 *  evaluar (F6-B, plan §10). Cero créditos si la receta no tiene pregunta propia. */
export async function costeProbarConPregunta(id: string): Promise<CostePregunta | string> {
  return llamar<CostePregunta>(`/liga/estrategias/${id}/pruebas/coste`);
}

export async function porQueNoSale(id: string, ticker: string): Promise<PorQue | string> {
  return llamar<PorQue>(`/liga/estrategias/${id}/por-que/${encodeURIComponent(ticker)}`);
}

/** `senal` (AbortController) para que quien busca en un input pueda descartar una respuesta que
 *  ya no toca porque el usuario ha seguido escribiendo (ver H4 del informe de fluidez). */
export async function buscarUniverso(
  q: string, senal?: AbortSignal,
): Promise<EmpresaBusqueda[] | string> {
  return llamar<EmpresaBusqueda[]>(
    `/liga/universo/buscar?q=${encodeURIComponent(q)}`, { signal: senal },
  );
}

export async function getFicha(id: string): Promise<Ficha | string> {
  return llamar<Ficha>(`/liga/fichas/${id}`);
}

export type NotasEmpresa = {
  ticker: string;
  jornada: number;
  dia: string;
  /** De 0 a 9; null si esa jornada no guardó el escaneo. Llegan como texto decimal. */
  notas: Partial<Record<"negocio" | "precio" | "deuda" | "pronto", string>> | null;
};

export async function getNotasEmpresa(fichaId: string, ticker: string): Promise<NotasEmpresa | string> {
  return llamar<NotasEmpresa>(`/liga/fichas/${fichaId}/empresas/${encodeURIComponent(ticker)}`);
}

export async function copiarEstrategia(id: string): Promise<Estrategia | string> {
  return llamar<Estrategia>(`/liga/estrategias/${id}/copiar`, { method: "POST" });
}

// ---- «Leer a fondo» / «Leer mi cartera» (plan §10, F6-B) ---------------------------------------

export type Lectura = {
  id: number;
  ticker: string;
  texto: string;
  fuentes: unknown[];
  ya_comprada: boolean;
  creditos_cobrados: number;
};

export async function leerAFondo(ticker: string, idempotencia: string,
  contexto?: { estrategia_id: string; prueba_id: string }): Promise<Lectura | string> {
  return llamar<Lectura>(`/liga/lecturas/${encodeURIComponent(ticker)}`, {
    method: "POST", body: JSON.stringify({ idempotencia, ...contexto }),
  }, true, 210000);
}

export async function lecturasCompradas(estrategiaId: string, pruebaId: string): Promise<Lectura[] | string> {
  return llamar<Lectura[]>(`/liga/estrategias/${estrategiaId}/lecturas?prueba_id=${encodeURIComponent(pruebaId)}`);
}

export async function verLectura(id: number): Promise<Lectura | string> {
  return llamar<Lectura>(`/liga/lecturas/${id}`);
}

export async function leerMiCartera(
  estrategiaId: string, idempotencia: string,
): Promise<{ lecturas: Lectura[]; creditos_cobrados: number } | string> {
  return llamar<{ lecturas: Lectura[]; creditos_cobrados: number }>(
    `/liga/estrategias/${estrategiaId}/lecturas`,
    { method: "POST", body: JSON.stringify({ idempotencia }) },
    true, 210000,
  );
}

// ---- Conversor: frase libre → reglas sugeridas (plan §10, F6-A) --------------------------------

export type InterpretacionIdea = {
  intencion: string;
  tipo: "exacta" | "aproximada" | "no_disponible";
  regla: string | null;
  motivo: string;
};

export type ConvertirResultado = {
  reglas: ReglaElegida[];
  interpretacion: InterpretacionIdea[];
  pesos: Record<string, number> | null;
  pregunta: string | null;
  nombre: string | null;
  quedan: number;
};

export async function convertirFrase(
  frase: string, estrategiaId?: string,
): Promise<ConvertirResultado | string> {
  return llamar<ConvertirResultado>("/liga/convertir", {
    method: "POST", body: JSON.stringify({ frase, estrategia_id: estrategiaId ?? null }),
  }, true, 60000);
}

// ---- Público: portada y clasificación (sin sesión, D3) ------------------------------------------

export type CasaClave = "alpha" | "omega" | "lambda";

export type EquipoPublico = {
  id: string;
  nombre: string;
  escudo: Escudo;
  casa: CasaClave | null;
  autor: string | null;
};

export type TemporadaPublica = {
  id: number;
  nombre: string;
  cuenta: boolean;
  estado: string;
  n_jornadas: number;
};

export type JornadaPublica = {
  id: number;
  temporada_id: number;
  numero: number;
  dia_inicio: string;
  dia_fin: string;
  cierre_inscripcion: string;
  estado: string;
  sp_rentabilidad: number | null;
};

export type RentabilidadAcumulada = {
  rentabilidad: number;
  sp500: number;
  diferencia_pp: number;
  desde: string;
  hasta: string;
  periodos: number;
  incompleta: boolean;
};

export type FilaJornadaPublica = {
  equipo: EquipoPublico;
  rentabilidad: number | null;
  dif_sp: number | null;
  puntos: number | null;
};

export type JornadaDetalle = {
  jornada: JornadaPublica; total: number; filas: FilaJornadaPublica[];
  /** Jornada en juego: cifras del último cierre (`hasta`), no las oficiales. */
  provisional?: boolean; hasta?: string | null;
  actualizado?: string | null; en_vivo?: boolean; precios_pendientes?: number;
};

export type Portada = {
  temporada: TemporadaPublica | null;
  proxima: JornadaPublica | null;
  en_juego: JornadaPublica | null;
  ultima_cerrada: JornadaDetalle | null;
  /** Estrategias de usuario apuntadas a la próxima jornada, y las que juegan la que está en curso. */
  apuntadas?: number;
  inscritas_en_juego?: number;
};

export type FilaClasificacion = {
  posicion: number;
  equipo: EquipoPublico;
  puntos: number;
  jornadas: number;
  ganadas: number;
  empatadas: number;
  perdidas: number;
  dif_sp: number;
  acumulado: RentabilidadAcumulada | null;
  /** Places moved up since the immediately preceding completed period. */
  movimiento: number | null;
};

export type OrdenClasificacion = "rentabilidad" | "puntos";

/** `mias`: las del alias pedido que quedan fuera de la página, con su posición real. */
export type Clasificacion = {
  temporada: TemporadaPublica; total: number; filas: FilaClasificacion[]; mias: FilaClasificacion[];
};

export async function getPortada(): Promise<Portada | string> {
  return llamar<Portada>("/liga/publico/portada", {}, false);
}

/** El premio anual, sin nombres. `visible` falso: no hay nada que enseñar todavía. */
export type PremioPublico = {
  visible: boolean;
  temporada?: { id: number; nombre: string } | null;
  calculado: boolean;
  cuentas: number;
  escalon: 0 | 1 | 2;
  umbral_basico: number | null;
  umbral_completo: number | null;
  importes: Record<string, number[]>;
};

export async function getPremio(): Promise<PremioPublico | string> {
  return llamar<PremioPublico>("/liga/publico/premio", {}, false);
}

export async function getClasificacion(
  opciones: { temporada?: number; desde?: number; cuantos?: number; alias?: string; orden?: OrdenClasificacion } = {},
): Promise<Clasificacion | string> {
  const q = new URLSearchParams();
  if (opciones.alias) q.set("alias", opciones.alias);
  if (opciones.temporada != null) q.set("temporada", String(opciones.temporada));
  q.set("desde", String(opciones.desde ?? 0));
  q.set("cuantos", String(opciones.cuantos ?? 50));
  q.set("orden", opciones.orden ?? "rentabilidad");
  return llamar<Clasificacion>(`/liga/publico/clasificacion?${q.toString()}`, {}, false);
}

export async function getJornadaPublica(id: number): Promise<JornadaDetalle | string> {
  return llamar<JornadaDetalle>(`/liga/publico/jornada/${id}`, {}, false);
}

// ---- Ligas privadas (Pro), créditos y reportes ---------------------------------------------------

export type LigaResumen = {
  id: string;
  nombre: string;
  cupo: number;
  oculta: boolean;
  creada: string;
  es_dueno: boolean;
  codigo: string | null;
  n_miembros: number;
  /** Solo en la lista: tu resultado del mes, S&P 500 de esa jornada y quién va primero. */
  mio?: number | null;
  sp500_mes?: number | null;
  lider?: string | null;
};

export type MiembroLiga = {
  alias: string;
  es_yo: boolean;
  unido: string;
  puntos: number | null;
  jornadas: number | null;
  dif_sp: number | null;
  acumulado: RentabilidadAcumulada | null;
  movimiento: number | null;
  estrategia: { id: string; nombre: string; visibilidad: string; escudo: Escudo } | null;
  rentabilidad_mes: number | null;
  diferencia_mes: number | null;
};

export type LigaDetalle = LigaResumen & { miembros: MiembroLiga[]; jornada_numero: number | null;
  datos_hasta: string | null; sp500_mes: number | null; en_vivo: boolean; consultado: string | null };

export async function misLigas(): Promise<LigaResumen[] | string> {
  return llamar<LigaResumen[]>("/liga/ligas");
}

export async function crearLiga(nombre: string, cupo?: number): Promise<LigaResumen | string> {
  return llamar<LigaResumen>("/liga/ligas", {
    method: "POST", body: JSON.stringify(cupo ? { nombre, cupo } : { nombre }),
  });
}

export async function unirseLiga(codigo: string): Promise<LigaResumen | string> {
  return llamar<LigaResumen>("/liga/ligas/unirse", {
    method: "POST", body: JSON.stringify({ codigo }),
  });
}

export async function verLiga(id: string): Promise<LigaDetalle | string> {
  return llamar<LigaDetalle>(`/liga/ligas/${id}`);
}

export async function salirLiga(id: string): Promise<true | string> {
  const r = await llamar<undefined>(`/liga/ligas/${id}/yo`, { method: "DELETE" });
  return typeof r === "string" ? r : true;
}

export async function rotarCodigoLiga(id: string): Promise<LigaResumen | string> {
  return llamar<LigaResumen>(`/liga/ligas/${id}/codigo`, { method: "POST" });
}

export async function expulsarDeLiga(id: string, alias: string): Promise<true | string> {
  const r = await llamar<undefined>(`/liga/ligas/${id}/miembros/${encodeURIComponent(alias)}`,
    { method: "DELETE" });
  return typeof r === "string" ? r : true;
}

export type MovimientoCredito = { id: number; importe: number; motivo: string; creado: string };
export type Creditos = { saldo: number; total: number; movimientos: MovimientoCredito[] };

export async function getCreditos(): Promise<Creditos | string> {
  return llamar<Creditos>("/liga/creditos");
}

export type TipoReporte = "alias" | "estrategia" | "liga" | "pregunta";

export async function reportar(
  tipo: TipoReporte, objetoId: string, motivo: string,
): Promise<true | string> {
  const r = await llamar<unknown>("/liga/reportes", {
    method: "POST", body: JSON.stringify({ tipo, objeto_id: objetoId, motivo }),
  });
  return typeof r === "string" ? r : true;
}
