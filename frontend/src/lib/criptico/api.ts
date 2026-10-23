import { get, post } from "@/lib/api";
import type { Detalle, Entrega, Idioma } from "./tipos";

export const hoy = (idioma: Idioma) => get<Entrega>(`/criptico/hoy?idioma=${idioma}`);
export const numero = (n: number, idioma: Idioma) => get<Entrega>(`/criptico/numero/${n}?idioma=${idioma}`);
export const letra = (id: number) => post<{ letra: string }>(`/criptico/${id}/letra`, {});
export const comprobar = (id: number, letras: string) =>
  post<{ correcta: boolean; detalle: Detalle | null }>(`/criptico/${id}/comprobar`, { letras });
export const resuelto = (id: number, ayudas_usadas: number) => post<void>(`/criptico/${id}/resuelto`, { ayudas_usadas });
export const solucion = (id: number, ayudas_usadas: number) =>
  post<{ detalle: Detalle }>(`/criptico/${id}/solucion`, { ayudas_usadas });
export const suscribir = (email: string, idioma: Idioma) => post<void>("/criptico/suscripcion", { email, idioma });
export const confirmar = (token: string) => get<{ ok: boolean }>(`/criptico/suscripcion/confirmar?token=${encodeURIComponent(token)}`);
export const baja = (token: string) => get<{ ok: boolean }>(`/criptico/suscripcion/baja?token=${encodeURIComponent(token)}`);
