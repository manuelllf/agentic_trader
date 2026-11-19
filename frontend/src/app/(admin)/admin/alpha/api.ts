// Cliente del servicio del agente (otro servicio, no el backend de Vennett). Misma sesión: el JWT de Supabase con 2FA.
import { tokenSesion } from "@/lib/liga/supabase";

const TIMEOUT_MS = 15_000;

export type TipoFallo = "sin_url" | "red" | "sesion" | "http";

/** Por qué no llegaron los datos; la pantalla lo traduce a un texto, no enseña el mensaje crudo. */
export class AgenteError extends Error {
  constructor(readonly tipo: TipoFallo, readonly estado?: number) {
    super(`agente:${tipo}${estado ? `:${estado}` : ""}`);
    this.name = "AgenteError";
  }
}

// Se lee en cada llamada: Next sustituye el literal al compilar y las pruebas pueden cambiarlo.
const base = () => (process.env.NEXT_PUBLIC_AGENTE_API_URL ?? "").trim().replace(/\/+$/, "");

async function pedir(ruta: string, init?: RequestInit): Promise<unknown> {
  const url = base();
  if (!url) throw new AgenteError("sin_url");
  const ctrl = new AbortController();
  const temporizador = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const sesion = await tokenSesion();
    const token = sesion?.aal === "aal2" ? sesion.token : null;
    const cabeceras = {
      ...(init?.headers as Record<string, string> | undefined),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    let res: Response;
    try {
      res = await fetch(`${url}${ruta}`, { cache: "no-store", signal: ctrl.signal, ...init, headers: cabeceras });
    } catch {
      throw new AgenteError("red");
    }
    if (res.status === 401) {
      if (typeof window !== "undefined") window.dispatchEvent(new Event("agentic-unauthorized"));
      throw new AgenteError("sesion", 401);
    }
    if (!res.ok) throw new AgenteError("http", res.status);
    const texto = await res.text();
    return texto ? JSON.parse(texto) : undefined;
  } catch (e) {
    if (e instanceof AgenteError) throw e;
    throw new AgenteError("red");
  } finally {
    clearTimeout(temporizador);
  }
}

export const getAgente = <T>(ruta: string) => pedir(ruta) as Promise<T>;

export const postAgente = <T>(ruta: string, cuerpo: unknown) =>
  pedir(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }) as Promise<T>;
