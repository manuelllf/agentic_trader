import { browserText } from "../../i18n/browser";
import { browserLocale } from "../../i18n/locale";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

export function requisitosClave(clave: string): { longitud: boolean; mayuscula: boolean; simbolo: boolean } {
  return {
    longitud: Array.from(clave).length >= 8,
    mayuscula: /\p{Lu}/u.test(clave),
    simbolo: /[^\p{L}\p{N}\s]/u.test(clave),
  };
}

export function claveValida(clave: string): boolean {
  const requisitos = requisitosClave(clave);
  return requisitos.longitud && Array.from(clave).length <= 200 && requisitos.mayuscula && requisitos.simbolo;
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
    return browserText("system_offline");
  } finally {
    clearTimeout(espera);
  }
}

// Supabase llama `email` a la confirmación del alta en las plantillas con `token_hash`.
const TIPOS_DEL_ENLACE: Record<"signup" | "recovery", string[]> = { signup: ["signup", "email"], recovery: ["recovery"] };

/** Procesa el enlace del correo, llegue como `?code=` (PKCE), `token_hash` + `type` o tokens en el
 *  fragmento, y deja la URL sin ellos. `true` si el proveedor abrió la sesión. */
export async function completarEnlace(sb: SupabaseClient, tipo: "signup" | "recovery"): Promise<boolean> {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  window.history.replaceState(null, "", url.pathname);
  if (hash.has("error") || url.searchParams.has("error")) return false;
  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    return !error;
  }
  const tokenHash = url.searchParams.get("token_hash"), tipoEnlace = url.searchParams.get("type");
  if (tokenHash && tipoEnlace && TIPOS_DEL_ENLACE[tipo].includes(tipoEnlace)) {
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: tipoEnlace });
    return !error;
  }
  const access = hash.get("access_token"), refresh = hash.get("refresh_token");
  if (!access || !refresh || hash.get("type") !== tipo) return false;
  const { error } = await sb.auth.setSession({ access_token: access, refresh_token: refresh });
  return !error;
}

export type ResultadoConfirmacion = "confirmada" | "con-sesion" | "invalido";

/** Confirma el alta con el enlace del correo. Un enlace que ya no vale (recarga, segundo clic) no
 *  es un fallo si la sesión está puesta: la cuenta ya se confirmó y se puede entrar. */
export async function confirmarAlta(sb: SupabaseClient): Promise<ResultadoConfirmacion> {
  if (await completarEnlace(sb, "signup").catch(() => false)) return "confirmada";
  const sesion = await sb.auth.getSession().then((r) => r.data.session, () => null);
  return sesion ? "con-sesion" : "invalido";
}
