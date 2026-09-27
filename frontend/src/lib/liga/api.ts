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
