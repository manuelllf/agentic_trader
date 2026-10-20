// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import learn from "../../../../messages/es/learn.json";
import help from "../../../../messages/es/help.json";
import legal from "../../../../messages/es/legal.json";
import type { CicloAprender, MercadoAprender } from "@/lib/aprender";
import { guiasVisibles } from "./guias";
import { DeslizadorRoe } from "./_ui/DeslizadorRoe";
import { Hora } from "./_ui/Hora";
import { RelojCierre } from "./_ui/RelojCierre";
import { PrimerosPasos } from "./_ui/PrimerosPasos";

const sesion = vi.hoisted(() => ({ estado: "fuera" }));
const getPrimerosPasos = vi.hoisted(() => vi.fn());
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => sesion }));
vi.mock("@/lib/liga/api", () => ({ getPrimerosPasos }));

const messages = { ...learn, ...help, ...legal };
const mercado: MercadoAprender = { foto_id: 1, total: 5738, roe: { minimo: 0, maximo: 2, paso: 1, defecto: 1, pasan: [900, 537, 196] } };
const ciclo: CicloAprender = {
  jornada: { numero: 2, dia_base: "2026-10-30", dia_inicio: "2026-11-02", dia_fin: "2026-11-30" },
  escaneo: "2026-10-30T20:45:00Z", cierre_jornada: "2026-10-30T21:30:00Z", corte: "2026-10-30T22:00:00Z",
  cierre_cambios: "2026-11-02T14:00:00Z", apertura: "2026-11-02T14:30:00Z",
  puntos: { banda: "0.2", gana: 3, empata: 1, pierde: 0 }, premio: { visible: false },
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  sesion.estado = "fuera";
  getPrimerosPasos.mockReset();
  getPrimerosPasos.mockResolvedValue({ estrategia: false, apuntada: false, jornada_cerrada: false });
});
afterEach(() => act(() => root.unmount()));
async function render(children: ReactNode) {
  await act(async () => { root.render(<NextIntlClientProvider locale="es" messages={messages}>{children}</NextIntlClientProvider>); });
}

it("oculta la guía del premio cuando no es visible", () => {
  expect(guiasVisibles(false)).toHaveLength(4);
  expect(guiasVisibles(false).some(g => g.slug === "el-premio")).toBe(false);
  expect(guiasVisibles(true)).toHaveLength(5);
});
it("actualiza el recuento al mover el umbral", async () => {
  await render(<DeslizadorRoe mercado={mercado} />);
  expect(container.querySelector(".apr-recuento b")?.textContent).toBe("537");
  const input = container.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector(".apr-recuento b")?.textContent).toBe("196");
});
it("muestra la hora de Madrid y Nueva York", async () => {
  await render(<><Hora iso="2026-11-02T14:00:00Z" formato="hora" zona="Europe/Madrid" /><Hora iso="2026-11-02T14:00:00Z" formato="hora" zona="America/New_York" /></>);
  expect(Array.from(container.querySelectorAll("time"), e => e.textContent)).toEqual(["15:00", "09:00"]);
});
it("agrupa los hitos por día local y muestra la hora de Nueva York", async () => {
  await render(<RelojCierre ciclo={ciclo} zona="Europe/Madrid" />);
  expect(container.querySelectorAll(".apr-dia")).toHaveLength(2);
  expect(container.querySelectorAll(".apr-hito")).toHaveLength(5);
  expect(container.textContent).toContain("23:00");
  expect(container.textContent).toContain("18:00 NY");
  expect(container.textContent).toContain("Se cierra la jornada de octubre");
});
it("sin sesión no muestra primeros pasos ni los pide", async () => {
  await render(<PrimerosPasos ciclo={ciclo} />);
  expect(container.childElementCount).toBe(0);
  expect(getPrimerosPasos).not.toHaveBeenCalled();
});
it("con sesión muestra los cuatro pasos y el enlace para crear", async () => {
  sesion.estado = "dentro";
  await render(<PrimerosPasos ciclo={ciclo} />);
  expect(container.querySelectorAll("li")).toHaveLength(4);
  expect(container.querySelectorAll("li.hecho")).toHaveLength(1);
  expect(container.querySelector('a[href="/crear"]')).not.toBeNull();
  expect(getPrimerosPasos).toHaveBeenCalledTimes(1);
});
it("oculta los pasos cuando están todos completos", async () => {
  sesion.estado = "dentro";
  getPrimerosPasos.mockResolvedValue({ estrategia: true, apuntada: true, jornada_cerrada: true });
  await render(<PrimerosPasos ciclo={ciclo} />);
  expect(container.childElementCount).toBe(0);
});
