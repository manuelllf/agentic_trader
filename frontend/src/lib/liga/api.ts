// Cliente de la API de la liga (`/liga/*`). Manda el token de Supabase; las salas usan lib/api.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { tokenSesion } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Yo = {
  alias: string;
  plan: "gratis" | "pro";
  roles: string[];
  admin: boolean;
  aal2: boolean;
};

/** Entrar con el nombre de usuario: el backend busca el correo (nunca llega aquí) y devuelve la
 *  sesión, que se instala en el cliente de Supabase. null si ha ido bien; si no, el motivo. */
export async function entrarConAlias(
  sb: SupabaseClient, usuario: string, clave: string,
): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/liga/entrar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: usuario.trim(), clave }),
      cache: "no-store",
    });
  } catch {
    return "No se pudo entrar ahora. Prueba en un momento.";
  }
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => ({}))) as { detail?: string };
    return cuerpo.detail ?? "No se pudo entrar ahora. Prueba en un momento.";
  }
  const sesion = (await res.json()) as { access_token: string; refresh_token: string };
  const { error } = await sb.auth.setSession(sesion);
  return error ? "No se pudo entrar ahora. Prueba en un momento." : null;
}

/** Cambia el alias. Devuelve el perfil nuevo o el motivo por el que no se pudo. */
export async function cambiarAlias(alias: string): Promise<Yo | string> {
  const sesion = await tokenSesion();
  if (!sesion) return "Tu sesión ha caducado. Vuelve a entrar.";
  try {
    const res = await fetch(`${API_URL}/liga/yo`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${sesion.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ alias }),
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as Yo;
    const cuerpo = (await res.json().catch(() => ({}))) as { detail?: unknown };
    return typeof cuerpo.detail === "string" ? cuerpo.detail : "No se pudo guardar. Prueba otra vez.";
  } catch {
    return "No se pudo guardar. Prueba otra vez.";
  }
}

/** Quién eres según el backend; null sin sesión o si no responde. */
export async function getYo(): Promise<Yo | null> {
  const sesion = await tokenSesion();
  if (!sesion) return null;
  try {
    const res = await fetch(`${API_URL}/liga/yo`, {
      headers: { Authorization: `Bearer ${sesion.token}` },
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as Yo) : null;
  } catch {
    return null;
  }
}

// ---- Estrategias (crear/editar, receta, pruebas, ficha...) -------------------------------------
//
// Mensajes de error: el `detail` que manda la API ya está en castellano y se enseña tal cual
// (DESIGN.md §10); `SIN_SESION`/`SIN_RED` son los únicos que inventamos aquí.

const SIN_SESION = "Tu sesión ha caducado. Vuelve a entrar.";
const SIN_RED = "No se pudo hablar con el servidor. Prueba otra vez en un momento.";

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
  tope_pregunta: number;
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
};

export type PorQue = { ticker: string; motivo: string };
export type EmpresaBusqueda = { ticker: string; nombre: string | null; sector: string | null };

export type JornadaFicha = { numero: number; rentabilidad: number | null; puntos: number | null };
export type Posicion = { ticker: string; peso: number };

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
};

async function llamar<T>(
  ruta: string,
  opciones: RequestInit = {},
  conSesion = true,
): Promise<T | string> {
  const cabeceras: Record<string, string> = { ...(opciones.headers as Record<string, string> ?? {}) };
  if (conSesion) {
    const sesion = await tokenSesion();
    if (!sesion) return SIN_SESION;
    cabeceras.Authorization = `Bearer ${sesion.token}`;
  }
  if (opciones.body) cabeceras["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${ruta}`, { ...opciones, headers: cabeceras, cache: "no-store" });
  } catch {
    return SIN_RED;
  }
  if (res.status === 204) return undefined as T;
  const cuerpo = await res.json().catch(() => null);
  if (res.ok) return cuerpo as T;
  const detalle = (cuerpo as { detail?: unknown } | null)?.detail;
  if (typeof detalle === "string") return detalle;
  return SIN_RED;
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

export async function probarEstrategia(id: string): Promise<Prueba | string> {
  return llamar<Prueba>(`/liga/estrategias/${id}/pruebas`, { method: "POST" });
}

export async function porQueNoSale(id: string, ticker: string): Promise<PorQue | string> {
  return llamar<PorQue>(`/liga/estrategias/${id}/por-que/${encodeURIComponent(ticker)}`);
}

export async function buscarUniverso(q: string): Promise<EmpresaBusqueda[] | string> {
  return llamar<EmpresaBusqueda[]>(`/liga/universo/buscar?q=${encodeURIComponent(q)}`);
}

export async function getFicha(id: string): Promise<Ficha | string> {
  return llamar<Ficha>(`/liga/fichas/${id}`);
}

export async function copiarEstrategia(id: string): Promise<Estrategia | string> {
  return llamar<Estrategia>(`/liga/estrategias/${id}/copiar`, { method: "POST" });
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

export type FilaJornadaPublica = {
  equipo: EquipoPublico;
  rentabilidad: number | null;
  dif_sp: number | null;
  puntos: number | null;
};

export type JornadaDetalle = { jornada: JornadaPublica; filas: FilaJornadaPublica[] };

export type Portada = {
  temporada: TemporadaPublica | null;
  proxima: JornadaPublica | null;
  en_juego: JornadaPublica | null;
  ultima_cerrada: JornadaDetalle | null;
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
};

export type Clasificacion = { temporada: TemporadaPublica; total: number; filas: FilaClasificacion[] };

export async function getPortada(): Promise<Portada | string> {
  return llamar<Portada>("/liga/publico/portada", {}, false);
}

export async function getClasificacion(
  opciones: { temporada?: number; desde?: number; cuantos?: number } = {},
): Promise<Clasificacion | string> {
  const q = new URLSearchParams();
  if (opciones.temporada != null) q.set("temporada", String(opciones.temporada));
  q.set("desde", String(opciones.desde ?? 0));
  q.set("cuantos", String(opciones.cuantos ?? 50));
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
};

export type MiembroLiga = {
  alias: string;
  es_yo: boolean;
  unido: string;
  puntos: number | null;
  jornadas: number | null;
  dif_sp: number | null;
};

export type LigaDetalle = LigaResumen & { miembros: MiembroLiga[] };

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
