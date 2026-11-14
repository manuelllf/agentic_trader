// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { createTranslator } from "use-intl/core";
import learn from "../../../../messages/es/learn.json";
import help from "../../../../messages/es/help.json";
import legal from "../../../../messages/es/legal.json";
import strategies from "../../../../messages/es/strategies.json";
import type { CicloAprender, MercadoAprender } from "@/lib/aprender";
import { guiasVisibles } from "./guias";
import { DeslizadorRoe } from "./_ui/DeslizadorRoe";
import { Hora } from "./_ui/Hora";
import { RelojCierre } from "./_ui/RelojCierre";
import { PrimerosPasos } from "./_ui/PrimerosPasos";
import { CuerpoGuia } from "./_ui/Guias";
import Aprender from "./page";
import PaginaGuia from "./[guia]/page";

const sesion = vi.hoisted(() => ({ estado: "fuera" }));
const getPrimerosPasos = vi.hoisted(() => vi.fn());
const datos = vi.hoisted(() => ({ ciclo: null as unknown, mercado: null as unknown }));
vi.mock("../_sesion/SesionContext", () => ({ useSesion: () => sesion }));
vi.mock("@/lib/liga/api", () => ({ getPrimerosPasos }));
vi.mock("@/lib/aprender", async orig => ({
  ...(await orig<typeof import("@/lib/aprender")>()),
  leerCiclo: async () => datos.ciclo,
  leerMercado: async () => datos.mercado,
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator: crear } = await import("use-intl/core");
  const es = await import("../../../../messages/es/learn.json");
  const ayuda = await import("../../../../messages/es/help.json");
  const legales = await import("../../../../messages/es/legal.json");
  const estr = await import("../../../../messages/es/strategies.json");
  const m = { ...es.default, ...ayuda.default, ...legales.default, ...estr.default, firma_articulo: "Por {autor}" };
  return { getTranslations: async () => crear({ locale: "es", messages: m }), getLocale: async () => "es" };
});
vi.mock("../_ui/CabeceraPagina", () => ({ CabeceraPagina: ({ titulo }: { titulo: string }) => <header data-testid="cab">{titulo}</header> }));
vi.mock("../_ui/BarraPestanas", () => ({ BarraPestanas: () => <nav data-testid="pestanas" /> }));
vi.mock("../legal/datos", () => ({ Contacto: () => <a href="mailto:hola@x.test">correo</a> }));

const messages = { ...learn, ...help, ...legal, ...strategies, firma_articulo: "Por {autor}" };
const tes = createTranslator({ locale: "es", messages });
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
  datos.ciclo = ciclo;
  datos.mercado = mercado;
  getPrimerosPasos.mockReset();
  getPrimerosPasos.mockResolvedValue({ estrategia: false, apuntada: false, jornada_cerrada: false });
});
afterEach(() => act(() => root.unmount()));
async function render(children: ReactNode) {
  await act(async () => { root.render(<NextIntlClientProvider locale="es" messages={messages}>{children}</NextIntlClientProvider>); });
}
async function pintarIndice(c: unknown) {
  datos.ciclo = c;
  await render(await Aprender());
}
async function pintarGuia(slug: string, c: unknown = ciclo) {
  datos.ciclo = c;
  await render(await PaginaGuia({ params: Promise.resolve({ guia: slug }) }));
}

it("oculta la guía del premio cuando no es visible", () => {
  expect(guiasVisibles(false)).toHaveLength(4);
  expect(guiasVisibles(false).some(g => g.slug === "el-premio")).toBe(false);
  expect(guiasVisibles(true)).toHaveLength(5);
});
it("actualiza el recuento y el relleno al mover el umbral", async () => {
  await render(<DeslizadorRoe mercado={mercado} />);
  expect(container.querySelector(".recuento b")?.textContent).toBe("537");
  const input = container.querySelector("input")!;
  expect(input.style.getPropertyValue("--p")).toBe("50%");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector(".recuento b")?.textContent).toBe("196");
  expect(input.style.getPropertyValue("--p")).toBe("100%");
});
it("muestra la hora de Madrid y Nueva York", async () => {
  await render(<><Hora iso="2026-11-02T14:00:00Z" formato="hora" zona="Europe/Madrid" /><Hora iso="2026-11-02T14:00:00Z" formato="hora" zona="America/New_York" /></>);
  expect(Array.from(container.querySelectorAll("time"), e => e.textContent)).toEqual(["15:00", "09:00"]);
});
it("agrupa los hitos por día local, con la hora de Nueva York y la ventana tras el corte", async () => {
  await render(<RelojCierre ciclo={ciclo} zona="Europe/Madrid" />);
  expect(container.querySelectorAll(".cu-cab")).toHaveLength(2);
  expect(container.querySelectorAll("ul.reloj")).toHaveLength(2);
  expect(container.querySelectorAll(".hito")).toHaveLength(5);
  expect(container.querySelectorAll(".hito.clave")).toHaveLength(2);
  expect(container.querySelectorAll(".ventana")).toHaveLength(1);
  expect(container.textContent).toContain("23:00");
  expect(container.textContent).toContain("18:00 NY");
  expect(container.textContent).toContain("Se cierra la jornada de la semana");
});
it("sin sesión no muestra primeros pasos ni los pide", async () => {
  await render(<PrimerosPasos ciclo={ciclo} />);
  expect(container.childElementCount).toBe(0);
  expect(getPrimerosPasos).not.toHaveBeenCalled();
});
it("con sesión muestra los cuatro pasos y el botón para crear", async () => {
  sesion.estado = "dentro";
  await render(<PrimerosPasos ciclo={ciclo} />);
  expect(container.querySelectorAll("li")).toHaveLength(4);
  expect(container.querySelectorAll(".pg-check.si")).toHaveLength(1);
  expect(container.querySelector('a.pg-mini[href="/crear"]')).not.toBeNull();
  expect(getPrimerosPasos).toHaveBeenCalledTimes(1);
});
it("los pasos hechos llevan marca y sin estrategia pendiente no hay botón", async () => {
  sesion.estado = "dentro";
  getPrimerosPasos.mockResolvedValue({ estrategia: true, apuntada: true, jornada_cerrada: false });
  await render(<PrimerosPasos ciclo={ciclo} />);
  expect(container.querySelectorAll(".pg-check.si svg")).toHaveLength(3);
  expect(container.querySelector(".pg-mini")).toBeNull();
});
it("oculta los pasos cuando están todos completos", async () => {
  sesion.estado = "dentro";
  getPrimerosPasos.mockResolvedValue({ estrategia: true, apuntada: true, jornada_cerrada: true });
  await render(<PrimerosPasos ciclo={ciclo} />);
  expect(container.childElementCount).toBe(0);
});

it("el índice sin sesión lista las guías y el próximo cierre, sin pasos", async () => {
  await pintarIndice(ciclo);
  expect(container.querySelector("h1")?.textContent).toBe("Tu primer mes en Vennett");
  expect(container.querySelector('.pg-lead a[href="/como-funciona"]')).not.toBeNull();
  expect(container.querySelectorAll("ul.numerado > li a.cu-celda.con-n")).toHaveLength(4);
  expect(container.querySelector("ul.reqs")).toBeNull();
  expect(container.querySelector(".valor.fuerte time")?.textContent).toMatch(/^\d{2}:00$/);
  expect(container.querySelector("[data-testid=cab]")?.textContent).toBe("Aprender");
  expect(container.querySelector(".pg-pie")).not.toBeNull();
});
it("el índice con sesión añade los primeros pasos", async () => {
  sesion.estado = "dentro";
  await pintarIndice(ciclo);
  expect(container.querySelectorAll("ul.reqs > li")).toHaveLength(4);
});
it("el índice incluye la guía del premio solo si el premio se ve", async () => {
  await pintarIndice({ ...ciclo, premio: { visible: true } });
  expect(container.querySelectorAll("ul.numerado > li")).toHaveLength(5);
  expect(container.querySelector('a[href="/aprender/el-premio"]')).not.toBeNull();
});

it("la guía lleva barra, índice lateral, firma, siguiente y ayuda", async () => {
  await pintarGuia("que-es-la-liga");
  expect(container.querySelector("[data-testid=cab]")?.textContent).toBe("Guía 1 de 4");
  expect(container.querySelector(".pg.con-indice > nav.pg-indice")).not.toBeNull();
  expect(container.querySelectorAll("nav.pg-indice a")).toHaveLength(4);
  expect(container.querySelector("nav.pg-indice a[aria-current]")?.getAttribute("href")).toBe("/aprender/que-es-la-liga");
  expect(container.querySelector(".pg-de")?.textContent).toBe("2 min");
  expect(container.querySelector('script[type="application/ld+json"]')).not.toBeNull();
  expect(container.querySelector(".pg-firma")?.textContent).toContain("Por");
  expect(container.querySelector('a.cu-celda.alta[href="/aprender/crear-tu-estrategia"]')).not.toBeNull();
  expect(container.querySelector(".cu-pie a")).not.toBeNull();
  expect(container.querySelectorAll(".casas svg[role=img]")).toHaveLength(3);
});
it("la última guía visible termina en crear", async () => {
  await pintarGuia("leer-la-clasificacion");
  expect(container.querySelector('a.cu-celda.alta[href="/crear"]')).not.toBeNull();
});
it("la guía 2 pinta los pasos y el deslizador", async () => {
  await pintarGuia("crear-tu-estrategia");
  expect(container.querySelectorAll(".pg-paso")).toHaveLength(5);
  expect(container.querySelector(".pg-regla input")).not.toBeNull();
});
it("la guía 3 pinta el reloj", async () => {
  await pintarGuia("que-pasa-al-cierre");
  expect(container.querySelectorAll("ul.reloj").length).toBeGreaterThan(0);
});
it("la guía 4 pinta la banda del ciclo y el enlace a la liga", async () => {
  await pintarGuia("leer-la-clasificacion");
  expect(container.querySelector(".pg-puntos .p3")?.textContent).toBe("3");
  expect(container.querySelector('a.cu-celda[href="/liga"]')?.textContent).toBe("Ver la clasificación");
});
it("la guía del premio pinta escalones y requisitos", async () => {
  const conPremio = { ...ciclo, premio: { visible: true, umbral_basico: 20, umbral_completo: 100, importes: { "1": [100, 50, 25], "2": [300, 150, 50] } } };
  await pintarGuia("el-premio", conPremio);
  const filas = Array.from(container.querySelectorAll(".cu-celda.alta small"), e => e.textContent ?? "");
  expect(filas.some(x => x.includes("1.º") && x.includes("300") && x.includes("2.º"))).toBe(true);
  expect(container.querySelectorAll(".cu-celda.texto").length).toBeGreaterThanOrEqual(4);
  expect(container.querySelector('a.cu-celda[href="/legal/bases-premio"]')).not.toBeNull();
});
it("la guía del premio da 404 si el premio no se ve", async () => {
  datos.ciclo = ciclo;
  await expect(PaginaGuia({ params: Promise.resolve({ guia: "el-premio" }) })).rejects.toThrow();
});
it("cada guía pinta su cuerpo", () => {
  for (const clave of ["g1", "g2", "g3", "g4"] as const) {
    const div = document.createElement("div");
    const r = createRoot(div);
    act(() => { r.render(<NextIntlClientProvider locale="es" messages={messages}><CuerpoGuia clave={clave} ciclo={ciclo} mercado={mercado} t={tes as never} locale="es" /></NextIntlClientProvider>); });
    expect(div.querySelector(".pg-sec, .pg-paso")).not.toBeNull();
    act(() => r.unmount());
  }
});
