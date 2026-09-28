// Cliente de Supabase Auth, solo en el navegador. La API es FastAPI: aquí solo hay cuentas y
// sesión, nunca lecturas de tablas.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const CLAVE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let cliente: SupabaseClient | null | undefined;

/** null sin las variables de entorno: sin cuentas, el resto de la web sigue funcionando. */
export function supabase(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (cliente === undefined) {
    cliente = URL && CLAVE
      ? createClient(URL, CLAVE, {
          auth: { persistSession: true, autoRefreshToken: true, storageKey: "liguilla-sesion" },
        })
      : null;
  }
  return cliente;
}

/** Para pintar: `undefined` hasta montar, igual que en el servidor, así la hidratación cuadra. */
export function useSupabase(): SupabaseClient | null | undefined {
  const [sb, setSb] = useState<SupabaseClient | null | undefined>(undefined);
  useEffect(() => setSb(supabase()), []);
  return sb;
}

function aalDe(token: string): string {
  try {
    const cuerpo = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return (JSON.parse(atob(cuerpo)) as { aal?: string }).aal ?? "aal1";
  } catch {
    return "aal1";
  }
}

/** Token de la sesión (ya refrescado si hacía falta) y su nivel. Solo para elegir qué mandar:
 *  quien decide es el backend. */
export async function tokenSesion(): Promise<{ token: string; aal: string } | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  return token ? { token, aal: aalDe(token) } : null;
}

/** El servidor rechazó el token (caducado o revocado): se cierra la sesión local y se lleva a
 *  entrar, para volver después a donde se estaba. En la propia pantalla de entrar no hace nada. */
export async function sesionCaducada(): Promise<void> {
  if (typeof window === "undefined") return;
  const aqui = window.location.pathname + window.location.search;
  if (aqui.startsWith("/entrar")) return;
  try {
    await supabase()?.auth.signOut();
  } catch {
    // Sin red o sin sesión que cerrar: se va a entrar igualmente.
  }
  window.location.assign(`/entrar?next=${encodeURIComponent(aqui)}`);
}

/** Solo rutas propias, para que `?next=` no pueda mandar a otra web. */
export function destinoSeguro(next: string | null, porDefecto = "/liga"): string {
  if (!next || !next.startsWith("/")) return porDefecto;
  // `/\evil.com` o `/%09/evil.com` se leen como otra web: solo vale lo que sigue en este origen.
  try {
    const url = new globalThis.URL(next, "https://origen.invalido");
    if (url.origin !== "https://origen.invalido") return porDefecto;
    return url.pathname + url.search + url.hash;
  } catch {
    return porDefecto;
  }
}
