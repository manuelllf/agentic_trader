// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import league from "../../../../messages/es/league.json";
import type { Estrategia, PremioYo } from "@/lib/liga/api";
import { ElegirEstrategia } from "./ElegirEstrategia";

const estado = vi.hoisted(() => ({
  propio: undefined as PremioYo | undefined,
  estrategias: undefined as Estrategia[] | string | undefined,
  yo: null as { alias: string } | null,
  atras: vi.fn(),
  optar: vi.fn(),
  invalidar: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: estado.atras }) }));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ yo: estado.yo }) }));
vi.mock("@/lib/liga/api", () => ({
  getPremioYo: vi.fn(), misEstrategias: vi.fn(), optarAlPremio: estado.optar,
}));
vi.mock("@/lib/liga/cache", () => ({
  useCache: (clave: string | null) => ({
    datos: clave === "premio-yo" ? estado.propio : clave === "mis-estrategias" ? estado.estrategias : undefined,
    fallo: false, refrescar: vi.fn(),
  }),
  invalidar: estado.invalidar,
}));
vi.mock("../_ui", () => ({ BarraPestanas: () => null }));
vi.mock("../_ui/CabeceraPagina", () => ({ CabeceraPagina: () => null }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  estado.atras.mockClear();
  estado.optar.mockReset();
  estado.invalidar.mockClear();
  estado.yo = { alias: "ana" };
  estado.propio = { temporada_id: 1, edad: "mayor", estrategia: { id: "a", nombre: "A" },
    jornadas_jugadas: 10, minimo_jornadas: 10, optas: true };
  estado.estrategias = [{ id: "a", nombre: "A" } as Estrategia, { id: "b", nombre: "B" } as Estrategia];
});
afterEach(() => act(() => root.unmount()));
function render() {
  act(() => root.render(<NextIntlClientProvider locale="es" messages={league}>
    <ElegirEstrategia />
  </NextIntlClientProvider>));
}
const botones = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button.cu-celda"));

it("lista las estrategias y marca la que opta", () => {
  render();
  expect(botones().map((b) => b.textContent)).toEqual(["A", "B"]);
  expect(botones()[0].querySelector(".marca-sel")).not.toBeNull();
  expect(botones()[1].querySelector(".marca-sel")).toBeNull();
  expect(container.textContent).toContain(league.premio_estrategia_elegir);
});
it("elegir otra llama a la API, invalida y vuelve", async () => {
  estado.optar.mockResolvedValue([]);
  render();
  await act(async () => botones()[1].click());
  expect(estado.optar).toHaveBeenCalledWith("b");
  expect(estado.invalidar).toHaveBeenCalledWith("mis-estrategias", "premio-yo");
  expect(estado.atras).toHaveBeenCalled();
});
it("tocar la que ya opta solo vuelve", async () => {
  render();
  await act(async () => botones()[0].click());
  expect(estado.optar).not.toHaveBeenCalled();
  expect(estado.atras).toHaveBeenCalled();
});
it("si la API falla, muestra el error en rojo y no vuelve", async () => {
  estado.optar.mockResolvedValue("No se pudo guardar");
  render();
  await act(async () => botones()[1].click());
  const aviso = container.querySelector("p.cu-pie.mal");
  expect(aviso?.textContent).toBe("No se pudo guardar");
  expect(aviso?.getAttribute("role")).toBe("alert");
  expect(estado.atras).not.toHaveBeenCalled();
  expect(estado.invalidar).not.toHaveBeenCalled();
});
it("cargando pinta el esqueleto", () => {
  estado.estrategias = undefined;
  render();
  expect(container.querySelector('[aria-busy="true"] .cu-esq')).not.toBeNull();
});
it("sin sesión invita a entrar", () => {
  estado.yo = null;
  render();
  expect(container.querySelector('a[href="/entrar?next=/premio/estrategia"]')).not.toBeNull();
});
