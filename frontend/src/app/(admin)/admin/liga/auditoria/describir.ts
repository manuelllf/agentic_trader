import { claveTituloAjuste } from "../ajustes/etiquetas";
import { dolares } from "../../_marco/formato";
export type Entrada = { accion: string; objeto: string | null; detalle: unknown };
type Traducir = (clave: string, valores?: Record<string, string | number>) => string;
const simple = (v: unknown): v is string | number | boolean => ["string", "number", "boolean"].includes(typeof v);
const limpio = (v: unknown) => simple(v) ? String(v).replace(/[{}"\[\]]/g, "").replace(/[–—]/g, "-") : "";
// El detalle casi siempre es un objeto; si es otra cosa (una lista), no se lee como tal.
const objetoPlano = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
export function describir(e: Entrada, t: Traducir, locale: string): string {
  const d = objetoPlano(e.detalle);
  const clave = claveTituloAjuste(e.objeto ?? "");
  const objeto = clave ? t(clave) : limpio(e.objeto);
  if (e.accion === "proceso.foto.auto.omitido") return t("admin_audit_photo_skipped", { razon: limpio(d.razon) });
  if (e.accion.startsWith("proceso.")) {
    const fallo = e.accion.endsWith(".fallo");
    const p = e.accion.slice(8).replace(/\.fallo$/, "");
    const nombres: Record<string, string> = { temporadas: "seasons", foto: "photo", formar: "form", diario: "daily", cerrar: "close" };
    const nombre = nombres[p] ? t(`admin_liga_process_${nombres[p]}`) : limpio(p);
    return t(fallo ? "admin_audit_process_failed" : "admin_audit_process_ok", { nombre, error: limpio(d.error) });
  }
  if (e.accion === "ajustes.cambiar") return simple(d.antes) && simple(d.despues)
    ? t("admin_audit_setting_values", { objeto, antes: limpio(d.antes), despues: limpio(d.despues) })
    : t("admin_audit_setting_changed", { objeto });
  if (e.accion === "usuario.rol") return t("admin_audit_role", { rol: limpio(d.rol) });
  if (e.accion === "copia.descargar") return t("admin_audit_copy");
  if (["ia.conversor", "ia.pregunta", "ia.lectura"].includes(e.accion)) {
    return t("admin_audit_ai", { finalidad: t(`admin_audit_${e.accion.slice(3)}`), coste: dolares(Number(d.coste_usd ?? d.coste ?? 0), locale) }) + (d.cache ? ` ${t("admin_audit_cache")}` : "");
  }
  const detalles = Object.entries(d).filter(([, v]) => simple(v)).map(([k, v]) => `${limpio(k)}: ${limpio(v)}`);
  return [limpio(e.accion), ...detalles].join(" · ");
}

export function describirObjeto(objeto: string | null, t: Traducir): string {
  if (!objeto || objeto === "liga" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(objeto)) return "";
  const partes = /^(jornada|temporada):(\d+)$/.exec(objeto);
  return partes ? t(`admin_audit_object_${partes[1]}`, { n: partes[2] }) : limpio(objeto);
}
