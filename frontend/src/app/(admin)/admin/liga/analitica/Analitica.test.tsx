// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import admin from "../../../../../../messages/es/admin.json";
import personas from "../../../../../../messages/es/panelPersonas.json";
import { get } from "@/lib/api";
import AnaliticaAdmin, { type AnaliticaOut } from "./page";
import { porcentaje, ritmo } from "./analitica";

vi.mock("@/lib/api", () => ({ get: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/components/AuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("funciones de analítica", () => {
  it("evita dividir entre cero y redondea porcentajes", () => {
    expect(porcentaje(0, 0)).toBeNull();
    expect(porcentaje(1, 3)).toBe(33);
  });
  it("compara el ritmo con el periodo anterior", () => {
    expect(ritmo(3, 5)).toBe("bajando");
    expect(ritmo(5, 3)).toBe("subiendo");
    expect(ritmo(3, 3)).toBe("igual");
  });
});

const datos: AnaliticaOut = {
  cifras: { cuentas: 100, nuevas_7d: 9, activas_7d: 71, visitas_7d: 174, ia_mes_usd: 1, tope_mensual_usd: 5 },
  visitas_7d_anterior: 100, embudo: { altas: 45, con_estrategia: 36, apuntadas: 30, jugaron: 20 },
  cohortes: Array.from({ length: 10 }, (_, i) => ({ semana: `2026-08-${String(i + 1).padStart(2, "0")}`, altas: i, con_estrategia: 1, apuntadas: 1, jugaron: 1 })),
  vuelta: [{ semana: "2026-08-10", jugaron: 1, base_2: 4, vuelven_2: 2, base_3: 0, vuelven_3: 0 }],
  visitas_dia: [{ dia: "2026-08-01", visitas: 30, cuentas: 1 }],
};

async function pintar() {
  vi.mocked(get).mockImplementation(async (url: string) => (url.includes("intenciones") ? [] : datos) as never);
  const div = document.createElement("div");
  const root = createRoot(div);
  await act(async () => root.render(
    <NextIntlClientProvider locale="es" messages={{ ...admin, ...personas }}><AnaliticaAdmin /></NextIntlClientProvider>));
  return { div, root };
}
const pulsar = async (div: HTMLElement, texto: string) => {
  const b = Array.from(div.querySelectorAll("button")).find(x => x.textContent === texto)!;
  await act(async () => b.click());
};

it("muestra las cuatro cifras, el ritmo, las visitas por día y las intenciones", async () => {
  const { div, root } = await pintar();
  try {
    expect(get).toHaveBeenCalledWith("/liga/admin/panel/analitica?dias=30");
    expect(get).toHaveBeenCalledWith("/liga/admin/intenciones?dias=90");
    expect(div.textContent).toContain("+74 frente a la semana anterior");
    expect(div.textContent).toContain("71 % de las cuentas");
    expect(div.textContent).not.toMatch(/cobrado|en juego/i);
    expect(div.querySelector("svg[role='img']")).not.toBeNull();
    expect(div.textContent).toContain(personas.pnl_personas_intenciones_vacio);
  } finally { act(() => root.unmount()); }
});

it("enseña el embudo, la vuelta y ocho semanas con altas", async () => {
  const { div, root } = await pintar();
  try {
    await pulsar(div, "Embudo");
    expect(div.querySelectorAll("[role='progressbar']")).toHaveLength(4);
    expect(div.querySelector("a[href='/admin/liga/consultas']")).not.toBeNull();
    await pulsar(div, "Vuelta");
    expect(div.textContent).toContain("50");
    await pulsar(div, "Semanas");
    expect(div.querySelectorAll(".pnl-grupo > li")).toHaveLength(8);
  } finally { act(() => root.unmount()); }
});
