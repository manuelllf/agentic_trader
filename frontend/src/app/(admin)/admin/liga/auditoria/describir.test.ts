import { createTranslator } from "next-intl";
import { expect, it } from "vitest";
import mensajes from "../../../../../../messages/es/admin.json";
import { describir, describirObjeto } from "./describir";
const t = createTranslator({ locale: "es", messages: mensajes as Record<string, string> });
it.each([
 ["proceso.foto", {}, "Proceso «foto»: bien"],
 ["proceso.formar.fallo", { error: "Sin foto" }, "Proceso «formar jornada» falló: Sin foto"],
 ["proceso.foto.auto.omitido", { razon: "Ya existe" }, "Foto automática omitida: Ya existe"],
 ["ajustes.cambiar", { antes: false, despues: true }, "Ajuste prueba: false → true"],
 ["ajustes.cambiar", {}, "Ajuste prueba cambiado"],
 ["usuario.rol", { rol: "admin" }, "Rol cambiado: admin"],
 ["copia.descargar", {}, "Copia de la liga descargada"],
 ["ia.conversor", { coste_usd: "1.24", cache: true }, "IA, conversor: 1,24 US$ (caché)"],
 ["ia.pregunta", { coste_usd: "1" }, "IA, pregunta: 1,00 US$"],
 ["ia.lectura", { coste_usd: "0" }, "IA, lectura: 0,00 US$"],
 ["otra", { texto: 'Un "dato" {simple}', numero: 2, activo: true, lista: [1], objeto: { a: 1 } }, "otra · texto: Un dato simple · numero: 2 · activo: true"],
] as const)("describe %s", (accion, detalle, esperado) => {
 const frase = describir({ accion, objeto: "prueba", detalle }, t, "es");
 expect(frase).toBe(esperado); expect(frase).not.toMatch(/[{"]/);
});

it.each([["jornada:2", "Jornada 2"], ["temporada:1", "Temporada 1"], ["liga", ""], ["123e4567-e89b-12d3-a456-426614174000", ""], [null, ""]])("objeto %s", (objeto, esperado) => {
 expect(describirObjeto(objeto, t)).toBe(esperado);
});
it.each(["ia.tope_mensual_usd", "panel.dias_inactiva", "liga.clasificacion_viva"])("traduce el ajuste %s", objeto => {
 const frase = describir({ accion: "ajustes.cambiar", objeto, detalle: {} }, t, "es");
 expect(frase).not.toContain(objeto);
 expect(frase).not.toContain("admin_setting");
});
