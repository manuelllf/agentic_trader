// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/es/league.json";
import type { PremioPublico, PremioYo } from "@/lib/liga/api";
import { PaginaPremio } from "./PaginaPremio";

const estado = vi.hoisted(() => ({
  premio: { visible: true } as PremioPublico,
  propio: undefined as PremioYo | undefined,
  yo: null as { alias: string } | null,
}));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ yo: estado.yo }) }));
vi.mock("@/lib/liga/cache", () => ({
  useCache: (clave: string | null) => ({
    datos: clave === "premio" ? estado.premio : clave === "premio-yo" ? estado.propio
      : clave === "portada" ? { temporada: { clave: "temporada_1", nombre: "Temporada", n_jornadas: 12 } } : undefined,
    fallo: false, refrescar: vi.fn(),
  }),
}));
vi.mock("../_ui", () => ({ BarraPestanas: () => null, Cargando: () => null, ErrorLiga: () => null }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  estado.yo = null;
  estado.propio = undefined;
  estado.premio = { visible: true, cuentas: 1, escalon: 0, calculado: false,
    umbral_basico: 100, umbral_completo: 250, importes: { "1": [150, 75, 25], "2": [300, 150, 50] } };
});
afterEach(() => act(() => root.unmount()));
function render() {
  act(() => root.render(<NextIntlClientProvider locale="es" messages={messages}>
    <PaginaPremio />
  </NextIntlClientProvider>));
}
function cuenta(optas: boolean, edad: PremioYo["edad"]) {
  estado.yo = { alias: "ana" };
  estado.propio = { temporada_id: 1, edad, estrategia: { id: "estrategia", nombre: "Mi estrategia" },
    jornadas_jugadas: 10, minimo_jornadas: 10, optas };
}

it("una cuenta muestra la cifra y la meta de activación de 100", () => {
  render();
  expect(container.querySelector("strong")?.textContent).toBe("1");
  expect(container.textContent).toContain("de 100 para activarlo");
});
it("140 cuentas muestran las 110 que faltan para el completo", () => {
  estado.premio = { ...estado.premio, cuentas: 140, escalon: 1 };
  render();
  expect(container.textContent).toContain("Primer escalón en juego. Con 110 cuentas más, los importes se doblan.");
});
it("sin sesión invita a entrar con retorno al premio", () => {
  render();
  expect(container.textContent).toContain(messages.premio_sesion);
  expect(container.querySelector('a[href="/entrar?next=/premio"]')).not.toBeNull();
});
it("una cuenta menor muestra el requisito y todavía no opta", () => {
  cuenta(false, "menor");
  render();
  expect(container.textContent).toContain(messages.premio_edad_menor);
  expect(Array.from(container.querySelectorAll("span")).some((e) => e.textContent === messages.premio_optas)).toBe(false);
  expect(container.textContent).toContain(messages.premio_no_optas);
});
it("una cuenta elegible muestra la pastilla de optas", () => {
  cuenta(true, "mayor");
  render();
  expect(Array.from(container.querySelectorAll("span")).some((e) => e.textContent === messages.premio_optas)).toBe(true);
});
it("un premio no visible ofrece volver a la liga", () => {
  estado.premio = { visible: false };
  render();
  expect(container.textContent).toContain(messages.premio_no_visible);
  expect(Array.from(container.querySelectorAll('a[href="/liga"]')).some((e) => e.textContent === messages.premio_volver)).toBe(true);
});
