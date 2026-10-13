// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import es from "../../../../messages/es/builder.json";
import { actualizarDatos, getActualizacion, type ActualizacionDatos, type RecetaEntrada } from "@/lib/liga/api";
import { ActualizarHoy } from "./ActualizarHoy";

vi.mock("@/lib/liga/api", () => ({ actualizarDatos: vi.fn(), getActualizacion: vi.fn() }));
vi.mock("next-intl", async importOriginal => {
  const original = await importOriginal<typeof import("next-intl")>();
  return { ...original, useLocale: () => "es", useTranslations: () => original.createTranslator({ locale: "es", messages: es }) };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const receta: RecetaEntrada = { reglas: [], excluidas: [], pregunta: null, pesos: {}, n_empresas: 5, reparto: "igual", max_por_sector: 2 };
const dato = (estado: ActualizacionDatos["estado"]): ActualizacionDatos => ({ estado, hechas: 42, total: 300,
  creada: "2026-10-13T10:00:00Z", puede_repetir_el: "2026-10-20T10:00:00Z" });
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-13T12:00:00Z")); });
afterEach(() => { if (root) act(() => root.unmount()); vi.useRealTimers(); });
async function montar(estrategiaId?: string, recetaActual: RecetaEntrada = receta) {
  const div = document.createElement("div"), alActualizar = vi.fn(); root = createRoot(div);
  await act(async () => root.render(<ActualizarHoy receta={recetaActual} estrategiaId={estrategiaId} alActualizar={alActualizar} />));
  return { div, alActualizar };
}
it("deshabilita el botón hasta puede_repetir_el", async () => {
  vi.mocked(getActualizacion).mockResolvedValue(dato("hecha"));
  const { div } = await montar();
  expect(div.querySelector("button")!.disabled).toBe(true);
  expect(div.textContent).toContain("Próxima actualización: 20 de octubre de 2026");
});
it("muestra progreso y sondea cada dos segundos", async () => {
  vi.mocked(getActualizacion).mockResolvedValue(dato("en_curso"));
  const { div } = await montar();
  expect(div.textContent).toContain("Pidiendo datos de hoy… 42 de 300");
  expect(div.querySelector("progress")!.value).toBe(42);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(getActualizacion).toHaveBeenCalledTimes(2);
});
it("al terminar muestra datos y notas de hoy y avisa una sola vez", async () => {
  vi.mocked(getActualizacion).mockResolvedValueOnce(dato("en_curso")).mockResolvedValue(dato("hecha"));
  const { div, alActualizar } = await montar();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(div.textContent).toContain("Datos y notas de hoy");
  expect(div.querySelector("progress")).toBeNull();
  expect(alActualizar).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(getActualizacion).toHaveBeenCalledTimes(2);
});
it("pide la actualización con la receta y la estrategia, y comienza el sondeo", async () => {
  vi.mocked(getActualizacion).mockResolvedValueOnce(null).mockResolvedValue(dato("en_curso"));
  vi.mocked(actualizarDatos).mockResolvedValue({ id: 1, total: 300 });
  const { div } = await montar("e-1");
  await act(async () => div.querySelector("button")!.click());
  expect(actualizarDatos).toHaveBeenCalledWith(receta, "e-1");
  expect(div.querySelector("progress")).not.toBeNull();
});
it("dice que la pregunta es gratis solo en la estrategia en juego, si la hay", async () => {
  vi.mocked(getActualizacion).mockResolvedValue(null);
  const { div } = await montar(undefined, { ...receta, pregunta: "¿Crece?" });
  expect(div.textContent).toContain("Con tu pregunta: gratis en tu estrategia en juego si tu cuenta es gratuita; en las demás, con créditos.");
});
it("no menciona créditos cuando la actualización no lleva pregunta", async () => {
  vi.mocked(getActualizacion).mockResolvedValue(null);
  const { div } = await montar();
  expect(div.textContent).not.toContain("Con tu pregunta");
});
it("muestra el fallo sin reintentar", async () => {
  vi.mocked(getActualizacion).mockResolvedValueOnce(dato("en_curso")).mockResolvedValue(dato("fallida"));
  const { div, alActualizar } = await montar();
  await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
  expect(div.textContent).toContain("No se pudo actualizar ahora. Prueba en un rato.");
  expect(getActualizacion).toHaveBeenCalledTimes(2);
  expect(actualizarDatos).not.toHaveBeenCalled();
  expect(alActualizar).not.toHaveBeenCalled();
});
it("cancela el sondeo al desmontar", async () => {
  vi.mocked(getActualizacion).mockResolvedValue(dato("en_curso"));
  await montar(); act(() => root.unmount());
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(getActualizacion).toHaveBeenCalledTimes(1);
});

it("vuelve a habilitar el botón cuando llega la próxima actualización", async () => {
  vi.mocked(getActualizacion).mockResolvedValue({ ...dato("hecha"), puede_repetir_el: "2026-10-13T12:00:02Z" });
  const { div } = await montar();
  expect(div.querySelector("button")!.disabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(div.querySelector("button")!.disabled).toBe(false);
});
it("no presenta una actualización de ayer como notas de hoy", async () => {
  vi.mocked(getActualizacion).mockResolvedValue({ ...dato("hecha"), creada: "2026-10-12T10:00:00Z" });
  const { div, alActualizar } = await montar();
  expect(div.textContent).not.toContain("Datos y notas de hoy");
  expect(alActualizar).not.toHaveBeenCalled();
});
