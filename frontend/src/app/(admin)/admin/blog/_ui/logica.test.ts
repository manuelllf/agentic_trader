import { expect, it } from "vitest";
import { fechaMadrid, totalSuscriptores } from "./logica";

it("convierte Madrid con su horario de invierno y verano y rechaza la hora inexistente", () => {
  expect(fechaMadrid("2027-01-10T09:00")?.toISOString()).toBe("2027-01-10T08:00:00.000Z");
  expect(fechaMadrid("2027-07-10T09:00")?.toISOString()).toBe("2027-07-10T07:00:00.000Z");
  expect(fechaMadrid("2027-03-28T02:30")).toBeNull();
  expect(fechaMadrid("")).toBeNull();
});

it("suma suscriptores por estado e idioma", () => {
  const datos = { envios: [], suscriptores: [
    { estado: "confirmado", idioma: "es" as const, total: 3 }, { estado: "confirmado", idioma: "en" as const, total: 2 },
    { estado: "baja", idioma: "es" as const, total: 1 }] };
  expect(totalSuscriptores(datos, "confirmado")).toBe(5);
  expect(totalSuscriptores(datos, "confirmado", "en")).toBe(2);
});
