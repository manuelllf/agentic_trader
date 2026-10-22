import { claveTituloAjuste } from "../ajustes/etiquetas";
import { dolares, fechaCorta } from "../../_marco/formato";
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
  if (e.accion === "proceso.diario.interruptor" && typeof d.activo === "boolean") return t(d.activo ? "admin_audit_interruptor_on" : "admin_audit_interruptor_off");
  if (e.accion.startsWith("proceso.")) {
    const fallo = e.accion.endsWith(".fallo");
    const p = e.accion.slice(8).replace(/\.fallo$/, "");
    const nombres: Record<string, string> = { temporadas: "seasons", foto: "photo", formar: "form", diario: "daily", cerrar: "close", premio: "prize", "diario.omega": "daily_omega", "foto.auto": "photo_auto", blog_publicar: "blog_publish", blog_boletin: "blog_send", blog_limpieza: "blog_clean" };
    const nombre = nombres[p] ? t(`admin_liga_process_${nombres[p]}`) : limpio(p);
    return t(fallo ? "admin_audit_process_failed" : "admin_audit_process_ok", { nombre, error: limpio(d.error) });
  }
  if (e.accion === "ajustes.cambiar") return simple(d.antes) && simple(d.despues)
    ? t("admin_audit_setting_values", { objeto, antes: limpio(d.antes), despues: limpio(d.despues) })
    : t("admin_audit_setting_changed", { objeto });
  if (["admin.rol", "rol.conceder"].includes(e.accion)) return t(d.conceder === true ? "admin_audit_rol_concedido" : "admin_audit_rol_quitado", { rol: limpio(d.rol) });
  if (e.accion === "copia.descargar") return t("admin_audit_copy");
  if (["ia.conversor", "ia.pregunta", "ia.lectura", "ia.formacion"].includes(e.accion)) {
    return t("admin_audit_ai", { finalidad: t(`admin_audit_${e.accion.slice(3)}`), coste: dolares(Number(d.coste_usd ?? d.coste ?? 0), locale) }) + (d.cache ? ` ${t("admin_audit_cache")}` : "");
  }
  if (e.accion === "admin.plan" && d.plan === "pro") return d.hasta
    ? t("admin_audit_plan_pro_hasta", { fecha: fechaCorta(limpio(d.hasta), locale) }) : t("admin_audit_plan_pro");
  if (e.accion === "admin.plan" && d.plan === "gratis") return t("admin_audit_plan_gratis");
  if (e.accion === "admin.pase" && d.pase === "liga") return d.hasta
    ? t("admin_audit_pase_hasta", { fecha: fechaCorta(limpio(d.hasta), locale) }) : t("admin_audit_pase");
  if (e.accion === "admin.pase" && d.pase === null) return t("admin_audit_pase_quitado");
  if (e.accion === "admin.creditos") return t("admin_audit_creditos", { importe: limpio(d.importe) });
  if (e.accion === "admin.usuario.alta") return t("admin_audit_usuario_alta", { alias: limpio(d.alias) });
  if (e.accion === "admin.ajuste.restablecer") return t("admin_audit_ajuste_restablecido", { objeto });
  if (e.accion === "cuenta.alias") return t("admin_audit_alias", { alias: limpio(d.alias) });
  if (e.accion === "cuenta.baja") return t("admin_audit_baja");
  if (e.accion === "liga.expulsar") return t("admin_audit_expulsion");
  if (e.accion === "blog.publicado") return t("admin_audit_blog_publicado");
  if (e.accion === "boletin.lote") return t("admin_audit_boletin_lote");
  if (e.accion === "boletin.limpieza") return t("admin_audit_boletin_limpieza", { borrados: limpio(d.borrados) });
  if (e.accion === "aviso.push") return t("admin_audit_aviso_push");
  if (e.accion === "aviso.ia_tope_80") return t("admin_audit_aviso_ia_80");
  if (e.accion === "aviso.cambios_cierran") return t("admin_audit_aviso_cambios");
  if (e.accion === "aviso.empieza") return t("admin_audit_aviso_empieza");
  if (e.accion === "resumen.enviado") return t("admin_audit_resumen_enviado");
  if (e.accion === "resumen.prueba.enviado") return t("admin_audit_resumen_prueba");
  if (e.accion === "resumen.semanal.lanzado") return t("admin_audit_resumen_semanal");
  if (e.accion === "resumen.mensual.lanzado") return t("admin_audit_resumen_mensual");
  if (e.accion === "omega.respaldo_recalculo") return t("admin_audit_respaldo_omega");
  if (e.accion === "pago.lemon") {
    const tipos: Record<string, string> = { alta: "alta", cambio: "cambio", baja: "baja", pro: "pro", pase: "pase", ignorar: "ignorar" };
    const tipo = Object.prototype.hasOwnProperty.call(tipos, limpio(d.tipo)) ? tipos[limpio(d.tipo)] : "";
    return t(tipo ? `admin_audit_lemon_${tipo}` : "admin_audit_lemon");
  }
  const detalles = Object.entries(d).filter(([, v]) => simple(v)).map(([k, v]) => `${limpio(k)}: ${limpio(v)}`);
  return [limpio(e.accion), ...detalles].join(" · ");
}

export function describirObjeto(objeto: string | null, t: Traducir): string {
  if (!objeto || objeto === "liga" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(objeto)) return "";
  const partes = /^(jornada|temporada):(\d+)$/.exec(objeto);
  return partes ? t(`admin_audit_object_${partes[1]}`, { n: partes[2] }) : limpio(objeto);
}
