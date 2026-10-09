import { browserLocale } from "../../i18n/locale";
// Cliente de `POST /liga/pagos/lemon/checkout`. La compra va a Lemon; aquí solo se pide la URL.
import { tokenSesion } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ProductoPago = "mensual" | "media_temporada" | "temporada" | "pack_liga";

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
    if (res.status === 409) return { error: producto === "pack_liga" ? "planes_ya_pase" : "planes_ya_pro" };
    if (res.status === 503) return { error: "planes_pago_no_disponible" };
    if (!res.ok) return { error: "planes_pago_error" };
    const cuerpo = (await res.json()) as { url?: string };
    if (!cuerpo.url) return { error: "planes_pago_error" };
    return { url: cuerpo.url };
  } catch {
    return { error: "planes_pago_error" };
  }
}
