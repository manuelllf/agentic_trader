// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/es/league.json";
import type { Estrategia, PremioPublico, PremioYo } from "@/lib/liga/api";
import { PaginaPremio } from "./PaginaPremio";

const estado = vi.hoisted(() => ({
  premio: { visible: true } as PremioPublico,
  propio: undefined as PremioYo | undefined,
  estrategias: undefined as Estrategia[] | undefined,
  yo: null as { alias: string } | null,
}));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ yo: estado.yo }) }));
vi.mock("@/lib/liga/cache", () => ({
  useCache: (clave: string | null) => ({
    datos: clave === "premio" ? estado.premio : clave === "premio-yo" ? estado.propio
      : clave === "mis-estrategias" ? estado.estrategias : undefined,
    fallo: false, refrescar: vi.fn(),
  }),
  invalidar: vi.fn(),
}));
vi.mock("../_ui", () => ({ BarraPestanas: () => null, Cargando: () => null, ErrorLiga: () => null }));

const temporada = { id: 1, nombre: "Temporada 1", clave: "temporada_1", n_jornadas: 12 };

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  estado.yo = null;
  estado.propio = undefined;
  estado.estrategias = undefined;
  estado.premio = { visible: true, temporada, cuentas: 1, escalon: 0, calculado: false,
    umbral_basico: 100, umbral_completo: 250, importes: { "1": [150, 75, 25], "2": [300, 150, 50] } };
});
afterEach(() => act(() => root.unmount()));
function render() {
  act(() => root.render(<NextIntlClientProvider locale="es" messages={messages}>
    <PaginaPremio />
  </NextIntlClientProvider>));
}
function cuenta(optas: boolean, edad: PremioYo["edad"], jugadas = 10) {
  estado.yo = { alias: "ana" };
  estado.propio = { temporada_id: 1, edad, estrategia: { id: "a", nombre: "Mi estrategia" },
    jornadas_jugadas: jugadas, minimo_jornadas: 10, optas };
  estado.estrategias = [{ id: "a", nombre: "Mi estrategia" } as Estrategia];
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
  const pastilla = container.querySelector(".premio-pill");
  expect(pastilla?.textContent).toBe(messages.premio_no_optas);
  expect(pastilla?.classList.contains("optas")).toBe(false);
});
it("una cuenta elegible muestra la pastilla de optas", () => {
  cuenta(true, "mayor");
  render();
  const pastilla = container.querySelector(".premio-pill.optas");
  expect(pastilla?.textContent).toBe(messages.premio_optas);
});
it("un premio no visible ofrece volver a la liga", () => {
  estado.premio = { visible: false };
  render();
  expect(container.textContent).toContain(messages.premio_no_visible);
  expect(Array.from(container.querySelectorAll('a[href="/liga"]')).some((e) => e.textContent === messages.premio_volver)).toBe(true);
});
it("las casillas de jornadas siguen la temporada del premio, no la de la portada", () => {
  cuenta(false, "mayor", 3);
  render();
  expect(container.querySelectorAll(".premio-casilla").length).toBe(12);
  expect(container.querySelectorAll(".premio-casilla.jugada").length).toBe(3);
});
it("la cuenta de jornadas dice cuántas faltan para el mínimo", () => {
  cuenta(false, "mayor", 3);
  render();
  expect(container.textContent).toContain("3 de 10 como mínimo. Te faltan 7.");
});
it("sin estrategias ofrece crear una", () => {
  cuenta(false, "mayor");
  estado.estrategias = [];
  render();
  expect(container.textContent).toContain(messages.premio_estrategia_ninguna);
  expect(container.querySelector('a[href="/crear"]')).not.toBeNull();
});
it("la estrategia del premio no es un enlace a Mías", () => {
  cuenta(true, "mayor");
  render();
  expect(container.querySelector('a[href="/mias"]')).toBeNull();
});
it("con varias estrategias, guardar empieza desactivado y elegir otra lo activa", () => {
  cuenta(false, "mayor");
  estado.estrategias = [{ id: "a", nombre: "A" } as Estrategia, { id: "b", nombre: "B" } as Estrategia];
  render();
  const guardar = () => container.querySelector<HTMLButtonElement>(".premio-guardar");
  expect(guardar()?.disabled).toBe(true);
  const radios = container.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  expect(radios[0].getAttribute("aria-checked")).toBe("true");
  act(() => radios[1].click());
  expect(radios[1].getAttribute("aria-checked")).toBe("true");
  expect(guardar()?.disabled).toBe(false);
});
