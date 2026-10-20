// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/es/league.json";
import type { Aviso } from "@/lib/liga/api";
import { cuando, textoAviso } from "./textoAviso";
import { PanelAvisos } from "./PanelAvisos";
import { Campana } from "./Campana";

vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => ({ estado: "fuera", yo: null }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const t = createTranslator({ locale: "es", messages }) as unknown as Parameters<typeof textoAviso>[1];
const aviso = (tipo: string, datos: Record<string, unknown> = {}): Aviso => ({
  id: 1, tipo, datos, creado: "2026-11-02T14:00:00Z", caduca: "2026-12-01T00:00:00Z", leido: false,
});

describe("textoAviso", () => {
  it("traduce la cartera y el cierre en la zona indicada", () => {
    const a = aviso("cartera_lista", { cierra: "2026-11-02T14:00:00Z" });
    const madrid = textoAviso(a, t, "es", "Europe/Madrid");
    expect(madrid?.titulo).toBe("Cartera de noviembre lista");
    expect(madrid?.texto).toContain("15:00");
    expect(textoAviso(a, t, "es", "America/New_York")?.texto).toContain("09:00");
  });
  it("formatea el resumen y contempla cifras ausentes", () => {
    const a = aviso("resumen_semanal", { numero: 2, rentabilidad: "1.2", sp: "0.9", puesto_general: 5 });
    expect(textoAviso(a, t, "es")?.texto).toContain("+1,2");
    expect(textoAviso(a, t, "es")?.texto).toContain("Puesto 5");
    a.datos.rentabilidad = null;
    expect(textoAviso(a, t, "es")?.texto).toBe("Aún sin cifras de tu estrategia.");
  });
  it("omite tipos desconocidos y cierres ausentes", () => {
    expect(textoAviso(aviso("desconocido"), t, "es")).toBeNull();
    expect(textoAviso(aviso("cartera_lista"), t, "es")).toBeNull();
    expect(textoAviso(aviso("cambios_cierran"), t, "es")).toBeNull();
  });
});

describe("cuando", () => {
  const ahora = new Date("2026-11-22T14:00:00Z");
  it("muestra la hora del mismo día", () => {
    expect(cuando("2026-11-22T12:00:00Z", ahora, "es", "Europe/Madrid")).toBe("13:00");
  });
  it("muestra el día corto de hace tres días", () => {
    const iso = "2026-11-19T12:00:00Z";
    const esperado = new Intl.DateTimeFormat("es", { weekday: "short", timeZone: "Europe/Madrid" }).format(new Date(iso)).replace(/\.$/, "");
    expect(cuando(iso, ahora, "es", "Europe/Madrid")).toBe(esperado);
  });
  it("muestra día y mes de hace veinte días", () => {
    const iso = "2026-11-02T12:00:00Z";
    const esperado = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "Europe/Madrid" }).format(new Date(iso)).replace(/\.$/, "");
    expect(cuando(iso, ahora, "es", "Europe/Madrid")).toBe(esperado);
  });
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it("muestra tres avisos y despliega los cinco conservando los nuevos", () => {
  const avisos = Array.from({ length: 5 }, (_, i) => ({ ...aviso("empieza"), id: i + 1, leido: i >= 2 }));
  act(() => root.render(<NextIntlClientProvider locale="es" messages={messages}>
    <PanelAvisos lista={{ sin_leer: 2, avisos }} enBarra={false} onIr={vi.fn()} onResumen={vi.fn()} />
  </NextIntlClientProvider>));
  expect(container.querySelectorAll(".aviso")).toHaveLength(3);
  const mas = container.querySelector<HTMLButtonElement>(".mas")!;
  expect(mas.textContent).toBe("Ver 2 más");
  expect(mas.getAttribute("aria-expanded")).toBe("false");
  act(() => mas.click());
  expect(container.querySelectorAll(".aviso")).toHaveLength(5);
  expect(container.querySelector("section")?.classList.contains("abierto")).toBe(true);
  expect(Array.from(container.querySelectorAll(".aviso"), a => a.classList.contains("nuevo"))).toEqual([true, true, false, false, false]);
});

it("la campana no pinta nada sin sesión", () => {
  act(() => root.render(<NextIntlClientProvider locale="es" messages={messages}>
    <Campana variante="cabecera" />
  </NextIntlClientProvider>));
  expect(container.innerHTML).toBe("");
});
