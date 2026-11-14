// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import league from "../../../../messages/es/league.json";
import learn from "../../../../messages/es/learn.json";
import type { Estrategia, PremioPublico, PremioYo } from "@/lib/liga/api";
import { PaginaPremio } from "./PaginaPremio";

const messages = { ...learn, ...league };

const estado = vi.hoisted(() => ({
  fallo: false,
  premio: { visible: true } as PremioPublico | undefined,
  propio: undefined as PremioYo | undefined,
  estrategias: undefined as Estrategia[] | undefined,
  yo: null as { alias: string } | null,
  refrescar: vi.fn(),
}));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ yo: estado.yo }) }));
vi.mock("@/lib/liga/cache", () => ({
  useCache: (clave: string | null) => ({
    datos: clave === "premio" ? estado.premio : clave === "premio-yo" ? estado.propio
      : clave === "mis-estrategias" ? estado.estrategias : undefined,
    fallo: clave === "premio" && estado.fallo, refrescar: estado.refrescar,
  }),
  invalidar: vi.fn(),
}));
vi.mock("../_ui", () => ({ BarraPestanas: () => null }));
vi.mock("../_ui/CabeceraPagina", () => ({ CabeceraPagina: () => null }));

const temporada = { id: 1, nombre: "Temporada 1", clave: "temporada_1", n_jornadas: 52, n_meses: 12 };

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  estado.fallo = false;
  estado.refrescar.mockClear();
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
  expect(container.querySelector(".pg-cifra b")?.textContent).toBe("1");
  expect(container.textContent).toContain("de 100 para activarlo");
});
it("140 cuentas muestran las 110 que faltan para el completo", () => {
  estado.premio = { ...estado.premio!, cuentas: 140, escalon: 1 };
  render();
  expect(container.textContent).toContain("Primer escalón en juego. Con 110 cuentas más, los importes se doblan.");
});
it("la barra marca el umbral básico y el progreso", () => {
  render();
  const barra = container.querySelector('[role="progressbar"]');
  expect(barra?.getAttribute("aria-valuenow")).toBe("1");
  expect(barra?.getAttribute("aria-valuemax")).toBe("250");
  expect(container.querySelector<HTMLElement>(".pg-barra .umbral")?.style.left).toBe("40%");
});
it("marca el escalón en juego y muestra los importes por puesto", () => {
  estado.premio = { ...estado.premio!, cuentas: 140, escalon: 1 };
  render();
  expect(container.querySelectorAll(".valor.en-juego").length).toBe(1);
  expect(container.textContent).toContain("Con 100 cuentas");
  expect(container.textContent).toContain("1.º 150 € · 2.º 75 € · 3.º 25 €");
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
  const pastilla = container.querySelector(".pg-pill");
  expect(pastilla?.textContent).toBe(messages.premio_no_optas);
  expect(pastilla?.classList.contains("si")).toBe(false);
});
it("una cuenta elegible muestra la pastilla de optas", () => {
  cuenta(true, "mayor");
  render();
  expect(container.querySelector(".pg-pill.si")?.textContent).toBe(messages.premio_optas);
});
it("sin declarar la edad enlaza a completar", () => {
  cuenta(false, "sin_declarar");
  render();
  expect(container.querySelector('a[href="/completar"]')).not.toBeNull();
});
it("un premio no visible ofrece volver a la liga", () => {
  estado.premio = { visible: false };
  render();
  expect(container.textContent).toContain(messages.premio_no_visible);
  expect(Array.from(container.querySelectorAll('a[href="/liga"]')).some((e) => e.textContent === messages.premio_volver)).toBe(true);
});
it("cargando pinta el esqueleto", () => {
  estado.premio = undefined;
  render();
  expect(container.querySelector('[aria-busy="true"] .cu-esq')).not.toBeNull();
});
it("el error ofrece reintentar", () => {
  estado.fallo = true;
  render();
  const boton = container.querySelector<HTMLButtonElement>(".pg-vacio .cu-boton.tintado");
  expect(boton?.textContent).toBe(messages.league_reintentar);
  act(() => boton?.click());
  expect(estado.refrescar).toHaveBeenCalled();
});
it("usa los meses del premio aunque la temporada tenga 52 jornadas", () => {
  cuenta(false, "mayor", 3);
  render();
  expect(container.querySelectorAll(".pg-meses i").length).toBe(12);
  expect(container.querySelectorAll(".pg-meses i.on").length).toBe(3);
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
  expect(container.querySelector('a[href="/crear"]')?.textContent).toBe(messages.premio_estrategia_crear);
});
it("con una sola estrategia no hay enlace para elegir", () => {
  cuenta(true, "mayor");
  render();
  expect(container.textContent).toContain(messages.premio_estrategia_unica);
  expect(container.querySelector('a[href="/premio/estrategia"]')).toBeNull();
});
it("con varias estrategias la fila enlaza a elegir y muestra la designada", () => {
  cuenta(false, "mayor");
  estado.estrategias = [{ id: "a", nombre: "Mi estrategia" } as Estrategia, { id: "b", nombre: "B" } as Estrategia];
  render();
  expect(container.querySelector('a[href="/premio/estrategia"]')?.textContent).toContain("Mi estrategia");
  expect(container.textContent).toContain(messages.premio_estrategia_elegir);
});
it("con varias estrategias y ninguna elegida dice Sin elegir", () => {
  cuenta(false, "mayor");
  estado.propio = { ...estado.propio!, estrategia: null };
  estado.estrategias = [{ id: "a", nombre: "A" } as Estrategia, { id: "b", nombre: "B" } as Estrategia];
  render();
  expect(container.querySelector('a[href="/premio/estrategia"]')?.textContent).toContain(messages.premio_sin_elegir);
});
it("enlaza a las bases", () => {
  render();
  expect(container.querySelector('a[href="/legal/bases-premio"]')).not.toBeNull();
});
