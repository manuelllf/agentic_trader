import { ApiError } from "@/lib/api";
import { tokenSesion } from "@/lib/liga/supabase";
import { browserLocale } from "@/i18n/locale";
import { browserText } from "@/i18n/browser";

export type Idioma = "es" | "en";
export type Estado = "borrador" | "programado" | "publicado";
export type Texto = { titulo: string; resumen: string; cuerpo: string };
export type Articulo = {
  id: number; slug: string; estado: Estado; programado_para: string | null;
  publicado_en: string | null; titulo_es: string; titulo_en: string;
  completo_es: boolean; completo_en: boolean;
};
export type Detalle = Omit<Articulo, "titulo_es" | "titulo_en" | "completo_es" | "completo_en"> & {
  creado: string; creado_por: string | null; actualizado_en: string | null;
  actualizado_por: string | null; textos: Record<Idioma, Texto>;
};
export type Guardar = { slug?: string; es: Texto; en: Texto };
export type Boletin = {
  suscriptores: { estado: string; idioma: Idioma; total: number }[];
  envios: { id: number; articulo_id: number; idioma: Idioma; estado: string;
    creado: string; terminado_en: string | null; pendiente: number; aceptada: number; fallida: number }[];
};

async function llamar<T>(ruta: string, method = "GET", body?: unknown): Promise<T> {
  const sesion = await tokenSesion();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/blog/admin${ruta}`, {
      method, cache: "no-store", signal: ctrl.signal,
      headers: { "Accept-Language": browserLocale(),
        ...(sesion?.aal === "aal2" ? { Authorization: `Bearer ${sesion.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("agentic-unauthorized"));
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(typeof data.detail === "string" ? data.detail : browserText("system_operation_failed"), "http", res.status);
    }
    return await res.json() as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(browserText(e instanceof DOMException && e.name === "AbortError"
      ? "system_backend_timeout" : "system_offline"), "network");
  } finally { clearTimeout(timer); }
}

export const listarArticulos = () => llamar<Articulo[]>("/articulos");
export const leerArticulo = (id: number) => llamar<Detalle>(`/articulos/${id}`);
export const crearArticulo = (slug: string) => llamar<{ id: number }>("/articulos", "POST", { slug });
export const guardarArticulo = (id: number, body: Guardar) => llamar<Detalle>(`/articulos/${id}`, "PUT", body);
export const resumenBoletin = () => llamar<Boletin>("/boletin");

export const publicarArticulo = (id: number, avisarBoletin: boolean) => llamar<Detalle>(`/articulos/${id}/publicar`, "POST", { avisar_boletin: avisarBoletin });
export const programarArticulo = (id: number, programadoPara: string, avisarBoletin: boolean) => llamar<Detalle>(`/articulos/${id}/programar`, "POST", { programado_para: programadoPara, avisar_boletin: avisarBoletin });
export const enviarPruebaBoletin = () => llamar<{ ok: true }>("/boletin/prueba", "POST");
