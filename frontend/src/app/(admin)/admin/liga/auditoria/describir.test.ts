import { createTranslator } from "next-intl";
import { expect, it } from "vitest";
import mensajes from "../../../../../../messages/es/admin.json";
import { fechaCorta } from "../../_marco/formato";
import { describir, describirObjeto } from "./describir";
const t = createTranslator({ locale: "es", messages: mensajes as Record<string, string> });
it.each([
 ["proceso.foto", {}, "Proceso «foto»: bien"],
 ["proceso.formar.fallo", { error: "Sin foto" }, "Proceso «formar jornada» falló: Sin foto"],
 ["proceso.foto.auto.omitido", { razon: "Ya existe" }, "Foto automática omitida: Ya existe"],
 ["ajustes.cambiar", { antes: false, despues: true }, "Ajuste prueba: false → true"],
 ["ajustes.cambiar", {}, "Ajuste prueba cambiado"],
 ["admin.rol", {"rol": "admin", "conceder": true}, "Rol concedido: admin"],
 ["admin.rol", {"rol": "admin", "conceder": false}, "Rol quitado: admin"],
 ["rol.conceder", {"rol": "admin", "conceder": true}, "Rol concedido: admin"],
 ["rol.conceder", {"rol": "admin"}, "Rol quitado: admin"],
 ["copia.descargar", {}, "Copia de la liga descargada"],
 ["ia.conversor", { coste_usd: "1.24", cache: true }, "IA, conversor: 1,24 US$ (caché)"],
 ["ia.pregunta", { coste_usd: "1" }, "IA, pregunta: 1,00 US$"],
 ["ia.lectura", { coste_usd: "0" }, "IA, lectura: 0,00 US$"],
 ["otra", { texto: 'Un "dato" {simple}', numero: 2, activo: true, lista: [1], objeto: { a: 1 } }, "otra · texto: Un dato simple · numero: 2 · activo: true"],
] as const)("describe %s", (accion, detalle, esperado) => {
 const frase = describir({ accion, objeto: "prueba", detalle }, t, "es");
 expect(frase).toBe(esperado); expect(frase).not.toMatch(/[{"]/);
});

it("acepta un detalle en lista", () => {
 const frase = describir({ accion: "omega.respaldo_recalculo", objeto: null, detalle: [{ a: 1 }] }, t, "es");
 expect(frase).toBe("Respaldo de Omega recalculado");
});

it.each([["jornada:2", "Jornada 2"], ["temporada:1", "Temporada 1"], ["liga", ""], ["123e4567-e89b-12d3-a456-426614174000", ""], [null, ""]])("objeto %s", (objeto, esperado) => {
 expect(describirObjeto(objeto, t)).toBe(esperado);
});
it.each(["ia.tope_mensual_usd", "panel.dias_inactiva", "liga.clasificacion_viva"])("traduce el ajuste %s", objeto => {
 const frase = describir({ accion: "ajustes.cambiar", objeto, detalle: {} }, t, "es");
 expect(frase).not.toContain(objeto);
 expect(frase).not.toContain("admin_setting");
});

it.each([
 ["admin.creditos", {"importe": 3}, "Créditos ajustados: 3"],
 ["admin.usuario.alta", {"alias": "Ana"}, "Cuenta creada: Ana"],
 ["admin.ajuste.restablecer", {}, "Ajuste restablecido: prueba"],
 ["cuenta.alias", {"alias": "Ana"}, "Alias cambiado a Ana"],
 ["cuenta.baja", {}, "Cuenta dada de baja"],
 ["liga.expulsar", {}, "Miembro expulsado de la liga"],
 ["blog.publicado", {}, "Artículo publicado"],
 ["boletin.lote", {}, "Lote del boletín enviado"],
 ["boletin.limpieza", {"borrados": 3}, "Limpieza del boletín: 3 borrados"],
 ["aviso.push", {}, "Aviso push a administradores"],
 ["aviso.ia_tope_80", {}, "La IA llegó al 80 % del tope mensual"],
 ["aviso.cambios_cierran", {}, "Cierran los cambios de la jornada"],
 ["aviso.empieza", {}, "Empieza la jornada"],
 ["resumen.enviado", {}, "Resumen enviado"],
 ["resumen.prueba.enviado", {}, "Resumen de prueba enviado"],
 ["resumen.semanal.lanzado", {}, "Resumen semanal lanzado"],
 ["resumen.mensual.lanzado", {}, "Resumen mensual lanzado"],
 ["omega.respaldo_recalculo", {}, "Respaldo de Omega recalculado"],
 ["admin.plan", {"plan": "pro"}, "Plan pro"],
 ["admin.plan", {"plan": "gratis"}, "Plan gratis"],
 ["admin.pase", {"pase": "liga"}, "Pase de liga"],
 ["admin.pase", {"pase": null}, "Pase de liga quitado"],
 ["ia.formacion", {"coste_usd": 0}, "IA, formación: 0,00 US$"],
 ["pago.lemon", {"tipo": "alta"}, "Pago de Lemon: alta"],
 ["pago.lemon", {"tipo": "cambio"}, "Pago de Lemon: cambio"],
 ["pago.lemon", {"tipo": "baja"}, "Pago de Lemon: baja"],
 ["pago.lemon", {"tipo": "pro"}, "Pago de Lemon: plan pro"],
 ["pago.lemon", {"tipo": "pase"}, "Pago de Lemon: pase de liga"],
 ["pago.lemon", {"tipo": "ignorar"}, "Pago de Lemon: ignorado"],
 ["pago.lemon", {"tipo": "otro"}, "Evento de pago de Lemon"],
 ["proceso.diario.interruptor", {"activo": true}, "Interruptor del cierre diario: encendido"],
 ["proceso.diario.interruptor", {"activo": false}, "Interruptor del cierre diario: apagado"],
 ["proceso.premio", {"error": "Error"}, "Proceso «premio»: bien"],
 ["proceso.premio.fallo", {"error": "Error"}, "Proceso «premio» falló: Error"],
 ["proceso.diario.omega", {"error": "Error"}, "Proceso «cierre diario de Omega»: bien"],
 ["proceso.diario.omega.fallo", {"error": "Error"}, "Proceso «cierre diario de Omega» falló: Error"],
 ["proceso.foto.auto", {"error": "Error"}, "Proceso «foto automática»: bien"],
 ["proceso.foto.auto.fallo", {"error": "Error"}, "Proceso «foto automática» falló: Error"],
 ["proceso.blog_publicar", {"error": "Error"}, "Proceso «publicar el blog»: bien"],
 ["proceso.blog_publicar.fallo", {"error": "Error"}, "Proceso «publicar el blog» falló: Error"],
 ["proceso.blog_boletin", {"error": "Error"}, "Proceso «enviar el boletín»: bien"],
 ["proceso.blog_boletin.fallo", {"error": "Error"}, "Proceso «enviar el boletín» falló: Error"],
 ["proceso.blog_limpieza", {"error": "Error"}, "Proceso «limpiar el boletín»: bien"],
 ["proceso.blog_limpieza.fallo", {"error": "Error"}, "Proceso «limpiar el boletín» falló: Error"],
] as const)("traduce la acción %s", (accion, detalle, esperado) => {
 const frase = describir({ accion, objeto: "prueba", detalle }, t, "es");
 expect(frase).toBe(esperado);
 expect(frase).not.toContain(accion);
 expect(frase).not.toContain("admin_audit_");
 expect(frase).not.toContain("admin_liga_process_");
});

it.each([
 ["admin.plan", { plan: "pro", hasta: "2030-06-15" }, "Plan pro hasta"],
 ["admin.pase", { pase: "liga", hasta: "2030-06-15" }, "Pase de liga hasta"],
] as const)("traduce la fecha de %s", (accion, detalle, prefijo) => {
 const frase = describir({ accion, objeto: null, detalle }, t, "es");
 expect(frase).toBe(`${prefijo} ${fechaCorta(detalle.hasta, "es")}`);
 expect(frase).not.toContain(accion);
 expect(frase).not.toContain("admin_audit_");
});

it("traduce el objeto del ajuste restablecido", () => {
 const objeto = "ia.tope_mensual_usd";
 const frase = describir({ accion: "admin.ajuste.restablecer", objeto, detalle: {} }, t, "es");
 expect(frase).toBe(`Ajuste restablecido: ${t("admin_setting_ai_cap_title")}`);
 expect(frase).not.toContain(objeto);
 expect(frase).not.toContain("admin_setting_");
});
