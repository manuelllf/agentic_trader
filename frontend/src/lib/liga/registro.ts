import { browserText } from "../../i18n/browser";
import { browserLocale } from "../../i18n/locale";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const REQUISITOS_CLAVE = "Al menos 8 caracteres, una mayúscula y un símbolo.";

export function useAccesoCorreo() {
  const [estado, setEstado] = useState<{ correo_disponible: boolean; registro_abierto: boolean } | null>(null);
  useEffect(() => {
    let activo = true;
    const abortar = new AbortController();
    const espera = setTimeout(() => abortar.abort(), 15000);
    fetch(`${API}/liga/registro`, { cache: "no-store", signal: abortar.signal })
      .then(async r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(datos => { if (activo) setEstado(datos); })
      .catch(() => { if (activo) setEstado({ correo_disponible: false, registro_abierto: false }); })
      .finally(() => clearTimeout(espera));
    return () => { activo = false; clearTimeout(espera); abortar.abort(); };
  }, []);
  return estado;
}

export function claveValida(clave: string): boolean {
  const longitud = Array.from(clave).length;
  return longitud >= 8 && longitud <= 200 && /\p{Lu}/u.test(clave)
    && /[^\p{L}\p{N}\s]/u.test(clave);
}

export async function solicitarCorreo(
  ruta: "" | "/recuperar" | "/reenviar", datos: Record<string, unknown>,
): Promise<string | null> {
  const abortar = new AbortController();
  const espera = setTimeout(() => abortar.abort(), 15000);
  try {
    const respuesta = await fetch(`${API}/liga/registro${ruta}`, {
      method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": browserLocale() },
      body: JSON.stringify({ ...datos, origen: window.location.origin }),
      signal: abortar.signal, cache: "no-store",
    });
    if (respuesta.ok) return null;
    const cuerpo = await respuesta.json().catch(() => ({}));
    return typeof cuerpo.detail === "string" ? cuerpo.detail : browserText("system_registration_invalid");
  } catch {
    return browserText("system_registration_connection");
  } finally {
    clearTimeout(espera);
  }
}

export async function completarEnlace(sb: SupabaseClient, tipo: "signup" | "recovery"): Promise<boolean> {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  window.history.replaceState(null, "", url.pathname);
  if (hash.has("error") || url.searchParams.has("error")) return false;
  const tokenHash = url.searchParams.get("token_hash");
  if (tokenHash && url.searchParams.get("type") === tipo) {
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: tipo });
    return !error;
  }
  const access = hash.get("access_token"), refresh = hash.get("refresh_token");
  if (!access || !refresh || hash.get("type") !== tipo) return false;
  const { error } = await sb.auth.setSession({ access_token: access, refresh_token: refresh });
  return !error;
}
