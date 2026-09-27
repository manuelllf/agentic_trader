// Cliente de `/liga/yo/exportar` y `DELETE /liga/yo` (plan §15, D17). Reusa `tokenSesion` de
// `./supabase`, igual que `api.ts` (que no se toca aquí: lo edita otro agente en paralelo).
import { tokenSesion } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Pide el JSON de «mis datos» y lo devuelve ya como texto formateado, listo para descargar.
 *  null sin sesión; si no, el motivo por el que no se pudo. */
export async function exportarMisDatos(): Promise<{ texto: string } | { error: string }> {
  const sesion = await tokenSesion();
  if (!sesion) return { error: "Tu sesión ha caducado. Vuelve a entrar." };
  try {
    const res = await fetch(`${API_URL}/liga/yo/exportar`, {
      headers: { Authorization: `Bearer ${sesion.token}` },
      cache: "no-store",
    });
    if (res.status === 429) return { error: "Demasiadas descargas seguidas. Espera un poco." };
    if (!res.ok) return { error: "No se pudo preparar la descarga. Prueba otra vez." };
    const cuerpo = await res.json();
    return { texto: JSON.stringify(cuerpo, null, 2) };
  } catch {
    return { error: "No se pudo preparar la descarga. Prueba otra vez." };
  }
}

/** Da de baja la cuenta ya (D17): borra al usuario en Supabase Auth y anonimiza sus estrategias.
 *  `confirmacion` tiene que ser el alias tal cual. null si ha ido bien; si no, el motivo. */
export async function borrarMiCuenta(confirmacion: string): Promise<string | null> {
  const sesion = await tokenSesion();
  if (!sesion) return "Tu sesión ha caducado. Vuelve a entrar.";
  try {
    const res = await fetch(`${API_URL}/liga/yo`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${sesion.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ confirmacion }),
      cache: "no-store",
    });
    if (res.status === 204) return null;
    const cuerpo = (await res.json().catch(() => ({}))) as { detail?: unknown };
    return typeof cuerpo.detail === "string" ? cuerpo.detail : "No se pudo dar de baja la cuenta.";
  } catch {
    return "No se pudo dar de baja la cuenta. Prueba otra vez.";
  }
}
