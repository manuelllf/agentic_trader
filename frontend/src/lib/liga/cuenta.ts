import { browserText } from "../../i18n/browser";
import { browserLocale } from "../../i18n/locale";
// Cliente de `/liga/yo/exportar` y `DELETE /liga/yo` (plan §15, D17). Reusa `tokenSesion` de
// `./supabase`, igual que `api.ts` (que no se toca aquí: lo edita otro agente en paralelo).
import { tokenSesion } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Pide el JSON de «mis datos» y lo devuelve ya como texto formateado, listo para descargar.
 *  null sin sesión; si no, el motivo por el que no se pudo. */
export async function exportarMisDatos(): Promise<{ texto: string } | { error: string }> {
  const sesion = await tokenSesion();
  if (!sesion) return { error: browserText("system_session_expired") };
  try {
    const res = await fetch(`${API_URL}/liga/yo/exportar`, {
      headers: { Authorization: `Bearer ${sesion.token}`, "Accept-Language": browserLocale() },
      cache: "no-store",
    });
    if (res.status === 429) return { error: browserText("system_download_rate_limit") };
    if (!res.ok) return { error: browserText("system_download_failed") };
    const cuerpo = await res.json();
    return { texto: JSON.stringify(cuerpo, null, 2) };
  } catch {
    return { error: browserText("system_download_failed") };
  }
}

/** Da de baja la cuenta ya (D17): borra al usuario en Supabase Auth y anonimiza sus estrategias.
 *  `confirmacion` tiene que ser la palabra de confirmación (ELIMINAR o DELETE). null si ha ido
 *  bien; si no, el motivo. */
export async function borrarMiCuenta(confirmacion: string): Promise<string | null> {
  const sesion = await tokenSesion();
  if (!sesion) return browserText("system_session_expired");
  try {
    const res = await fetch(`${API_URL}/liga/yo`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${sesion.token}`, "Accept-Language": browserLocale(), "Content-Type": "application/json" },
      body: JSON.stringify({ confirmacion }),
      cache: "no-store",
    });
    if (res.status === 204) return null;
    const cuerpo = (await res.json().catch(() => ({}))) as { detail?: unknown };
    return typeof cuerpo.detail === "string" ? cuerpo.detail : browserText("system_delete_account_failed");
  } catch {
    return browserText("system_delete_account_retry");
  }
}

export function debeCompletarCuenta(pendiente: boolean, ruta: string): boolean {
  return pendiente && !["/completar", "/auth/callback", "/legal", "/entrar", "/registrar", "/cambiar-clave"]
    .some(prefijo => ruta.startsWith(prefijo));
}
