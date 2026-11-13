import { expect, it } from "vitest";
import { tieneLista } from "./reglaTexto";
import type { ReglaCatalogo } from "@/lib/liga/api";

const regla = (tipos: string[]) => ({ parametros: tipos.map(tipo => ({ tipo })) }) as unknown as ReglaCatalogo;

it("una regla con lista de sectores va apilada; las de un número, no", () => {
  expect(tieneLista(regla(["sectores"]))).toBe(true);
  expect(tieneLista(regla(["numero"]))).toBe(false);
  expect(tieneLista(regla([]))).toBe(false);
});
