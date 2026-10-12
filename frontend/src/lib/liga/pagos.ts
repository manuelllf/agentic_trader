import { browserLocale } from "../../i18n/locale";
// Cliente de `POST /liga/pagos/lemon/checkout`. La compra va a Lemon; aquí solo se pide la URL.
import { tokenSesion } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ProductoPago = "mensual" | "media_temporada" | "temporada" | "pack_liga";
export type Suscripcion = {
  estado: "activa" | "cancelada" | "atrasada" | "impagada" | "pausada" | "caducada";
  producto: ProductoPago | null;
  renueva_en: string | null;
  termina_en: string | null;
  tarjeta_marca: string | null;
  tarjeta_ultimos4: string | null;
  portal_url: string | null;
  tarjeta_url: string | null;
};

async function gestionarSuscripcion<T>(ruta: string, method: "GET" | "POST",
  error: string, conflicto: string): Promise<T | { error: string }> {
  const sesion = await tokenSesion();
  if (!sesion) return { error: "planes_entra" };
  try {
    const res = await fetch(`${API_URL}/liga/pagos/lemon/${ruta}`, {
      method, headers: { Authorization: `Bearer ${sesion.token}`,
        "Accept-Language": browserLocale(), "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (res.status === 409) return { error: conflicto };
    if (res.status === 503) return { error: "planes_pago_no_disponible" };
    if (!res.ok) return { error };
    const dato: unknown = await res.json();
    if (!dato || typeof dato !== "object" || Array.isArray(dato)) return { error };
    return dato as T;
  } catch {
    return { error };
  }
}

export async function leerSuscripcion(): Promise<Suscripcion | { error: string }> {
  const res = await gestionarSuscripcion<Suscripcion>("suscripcion", "GET",
    "planes_suscripcion_error", "planes_suscripcion_no_disponible");
  if (!("error" in res) && !["activa", "cancelada", "atrasada", "impagada", "pausada",
    "caducada"].includes(res.estado)) return { error: "planes_suscripcion_error" };
  return res;
}

async function pedirGestion(ruta: "cancelar" | "reanudar"):
  Promise<{ ok: true } | { error: string }> {
  const res = await gestionarSuscripcion<{ estado: string }>(ruta, "POST",
    `planes_${ruta}_error`, ruta === "reanudar" ? "planes_reanudar_no_disponible"
      : "planes_suscripcion_no_disponible");
  if ("error" in res) return res;
  return res.estado === "pedido" ? { ok: true } : { error: `planes_${ruta}_error` };
}

export function cancelarSuscripcion() { return pedirGestion("cancelar"); }
export function reanudarSuscripcion() { return pedirGestion("reanudar"); }

/** URL de la pantalla de pago de Lemon, o el motivo por el que no se puede abrir. */
export async function abrirPago(producto: ProductoPago): Promise<{ url: string } | { error: string }> {
  const sesion = await tokenSesion();
  if (!sesion) return { error: "planes_entra" };
  try {
    const res = await fetch(`${API_URL}/liga/pagos/lemon/checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sesion.token}`, "Accept-Language": browserLocale(),
        "Content-Type": "application/json" },
      body: JSON.stringify({ producto }),
      cache: "no-store",
    });
    if (res.status === 409) return { error: "planes_ya_pro" };
    if (res.status === 503) return { error: "planes_pago_no_disponible" };
    if (!res.ok) return { error: "planes_pago_error" };
    const cuerpo = (await res.json()) as { url?: string };
    if (!cuerpo.url) return { error: "planes_pago_error" };
    return { url: cuerpo.url };
  } catch {
    return { error: "planes_pago_error" };
  }
}

/** Pasa el Pro de Lemon a otra duración (`POST /liga/pagos/lemon/cambiar-plan`). Lemon confirma
 *  el cambio después, por webhook: aquí solo se sabe que se ha pedido. */
export async function cambiarPlan(producto: Exclude<ProductoPago, "pack_liga">):
  Promise<{ ok: true } | { error: string }> {
  const sesion = await tokenSesion();
  if (!sesion) return { error: "planes_entra" };
  try {
    const res = await fetch(`${API_URL}/liga/pagos/lemon/cambiar-plan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sesion.token}`, "Accept-Language": browserLocale(),
        "Content-Type": "application/json" },
      body: JSON.stringify({ producto }),
      cache: "no-store",
    });
    if (res.status === 409) return { error: "planes_cambio_no_disponible" };
    if (res.status === 503) return { error: "planes_pago_no_disponible" };
    if (!res.ok) return { error: "planes_cambio_error" };
    return { ok: true };
  } catch {
    return { error: "planes_cambio_error" };
  }
}
