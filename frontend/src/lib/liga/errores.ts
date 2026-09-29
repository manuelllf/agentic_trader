// Cuando algo falla, la persona lo ve (aviso no bloqueante) y puede pulsar «Reportar»: queda una
// nota para el admin en la base, con el código del error (el mismo que sale en el servidor).
import { tokenSesion } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const EVENTO = "liguilla-error";

export type AvisoError = { codigo: string | null; pantalla: string; mensaje: string };

/** El servidor pone «(código a1b2c3)» en sus errores internos. */
export function codigoDe(mensaje: string): string | null {
  return /código ([0-9a-f]{6})/i.exec(mensaje)?.[1] ?? null;
}

/** Enseña el aviso de error en cualquier pantalla de la liga (lo pinta `<AvisoErrores />`). */
export function avisarError(mensaje: string): void {
  if (typeof window === "undefined") return;
  const detalle: AvisoError = { codigo: codigoDe(mensaje), pantalla: window.location.pathname, mensaje };
  window.dispatchEvent(new CustomEvent<AvisoError>(EVENTO, { detail: detalle }));
}

export function escucharErrores(fn: (aviso: AvisoError) => void): () => void {
  const alto = (e: Event) => fn((e as CustomEvent<AvisoError>).detail);
  window.addEventListener(EVENTO, alto);
  return () => window.removeEventListener(EVENTO, alto);
}

async function enviar(cuerpo: string, token: string | null): Promise<Response> {
  return fetch(`${API_URL}/liga/errores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo,
    cache: "no-store",
  });
}

/** Manda el aviso al admin. Devuelve si llegó. Con la sesión caducada el servidor rechaza el
 *  token, y justo entonces más falta hace poder avisar: se reintenta sin él. */
export async function reportarError(aviso: AvisoError, nota?: string): Promise<boolean> {
  const cuerpo = JSON.stringify({
    codigo: aviso.codigo,
    pantalla: aviso.pantalla.slice(0, 200),
    mensaje: aviso.mensaje.slice(0, 500),
    nota: nota?.trim() ? nota.trim().slice(0, 1000) : null,
    contexto: {
      navegador: navigator.userAgent.slice(0, 150),
      ancho: window.innerWidth,
      en_linea: navigator.onLine,
    },
  });
  try {
    const sesion = await tokenSesion();
    let res = await enviar(cuerpo, sesion?.token ?? null);
    if (res.status === 401 && sesion) res = await enviar(cuerpo, null);
    return res.ok;
  } catch {
    return false;
  }
}
