import { API_URL, ApiError } from "@/lib/api";
import type { EntradaIndice } from "./publico";
import type { Detalle, Entrega, Idioma } from "./tipos";

// El críptico es público: sin sesión y con tiempo máximo. Así un fallo nunca deja los botones bloqueados.
const TIMEOUT_MS = 15_000;

async function peticion<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      cache: "no-store", signal: ctrl.signal, ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new ApiError("network", "network");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ApiError("http", "http", res.status);
  const texto = await res.text();
  return (texto ? JSON.parse(texto) : undefined) as T;
}

const get = <T>(path: string) => peticion<T>(path);
const post = <T>(path: string, body?: unknown) =>
  peticion<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const hoy = (idioma: Idioma) => get<Entrega>(`/criptico/hoy?idioma=${idioma}`);
export const numero = (n: number, idioma: Idioma) => get<Entrega>(`/criptico/numero/${n}?idioma=${idioma}`);
export const indice = (idioma: Idioma) => get<EntradaIndice[]>(`/criptico/indice?idioma=${idioma}`);
export const letra = (id: number) => post<{ letra: string }>(`/criptico/${id}/letra`, {});
export const comprobar = (id: number, letras: string) =>
  post<{ correcta: boolean; detalle: Detalle | null }>(`/criptico/${id}/comprobar`, { letras });
export const resuelto = (id: number, ayudas_usadas: number) => post<void>(`/criptico/${id}/resuelto`, { ayudas_usadas });
export const solucion = (id: number, ayudas_usadas: number) =>
  post<{ detalle: Detalle }>(`/criptico/${id}/solucion`, { ayudas_usadas });
export const suscribir = (email: string, idioma: Idioma) => post<void>("/criptico/suscripcion", { email, idioma });
export const confirmar = (token: string) => get<{ ok: boolean }>(`/criptico/suscripcion/confirmar?token=${encodeURIComponent(token)}`);
export const baja = (token: string) => get<{ ok: boolean }>(`/criptico/suscripcion/baja?token=${encodeURIComponent(token)}`);
